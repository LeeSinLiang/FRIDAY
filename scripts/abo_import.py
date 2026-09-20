#!/usr/bin/env python3
"""Bring one Amazon Berkeley Objects (ABO) product into the catalogue: model, metadata and listing.

Usage, from backend/ (it needs the project's Python environment for the catalogue contract):
  uv run python ../scripts/abo_import.py <ASIN> --category <category> --price-cents <int> --price-provenance <placeholder|source>
                                         [--meta .scratch/abo/meta] [--work .scratch/abo] [--dry-run]

ABO (CC BY 4.0, https://amazon-berkeley-objects.s3.amazonaws.com/index.html) is the one source where
the model and the measurements come from the same record. This script still trusts neither half:

- Every dimension is parsed WITH its unit. The unit is inches on most records; an unknown unit, or a
  record whose value and normalized_value disagree, is refused. Nothing is ever assumed.
- ABO's "width" and "length" do not say which one runs left to right. The model does (X is width,
  Z is depth), so the model's own box decides, and it must then agree with the record inside the
  asset tolerance of backend/api/test_furniture_assets.py. If it does not, the item is refused.
- A width, depth or height stated in the product title (`83.5"W`) must agree too. ABO scaled its
  models to item_dimensions, so a wrong record gives a wrongly sized model that agrees with itself.
- Cameras, lights, animations and skins are removed: the renderer owns those.

Needs the ABO metadata on disk (listings_*.json.gz and 3dmodels.csv.gz under --meta) and `npx`.
Exit codes: 0 imported, 1 refused (the reason is printed), 2 bad arguments or missing metadata.
"""
import argparse
import csv
import gzip
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))
from api.glb import fit_to_height, measure, read_glb, write_glb  # noqa: E402
from catalogue.colour import _rgb  # noqa: E402
from catalogue.seed import PALETTE  # noqa: E402
from catalogue.types import CATEGORIES  # noqa: E402

BUCKET = "https://amazon-berkeley-objects.s3.amazonaws.com"
ASSETS = REPO / "shared" / "models" / "furniture"
LISTINGS = REPO / "backend" / "catalogue" / "data" / "listings.json"
MM_PER_UNIT = {"inches": 25.4, "centimeters": 10.0, "millimeters": 1.0, "meters": 1000.0, "feet": 304.8}
TOLERANCE_MM, TOLERANCE_RATIO = 20.0, 0.03  # the same rule as backend/api/test_furniture_assets.py
MAX_BYTES, MAX_TRIANGLES = 5 * 1024 * 1024, 30000
OPTIMIZE = ["npx", "--yes", "@gltf-transform/cli@4", "optimize"]
OPTIMIZE_FLAGS = ["--compress", "false", "--texture-compress", "auto", "--texture-size", "1024", "--simplify"]
LICENSE = {
    "name": "CC BY 4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "3D model and product data from Amazon Berkeley Objects (c) Amazon.com, licensed CC BY 4.0. "
                   "Dataset built by Matthieu Guillaumin, Thomas Dideriksen, Kenan Deng, Himanshu Arora (Amazon.com), "
                   "Jasmine Collins and Jitendra Malik (UC Berkeley).",
}


class Refused(Exception):
    """This product must not enter the catalogue; the message says why."""


def to_mm(entry: dict) -> float:
    """Millimetres from an ABO {value, unit, normalized_value} entry.

    Raises:
        Refused: the unit is unknown, the value is not a positive number, or the record contradicts itself.
    """
    unit = str(entry.get("unit", "")).strip().lower()
    value = entry.get("value")
    if unit not in MM_PER_UNIT:
        raise Refused(f"unknown dimension unit {entry.get('unit')!r}; refusing to guess")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise Refused(f"dimension value {value!r} is not a positive number")
    mm = value * MM_PER_UNIT[unit]
    normalized = entry.get("normalized_value") or {}
    n_unit = str(normalized.get("unit", "")).strip().lower()
    if n_unit in MM_PER_UNIT and isinstance(normalized.get("value"), (int, float)):
        if abs(normalized["value"] * MM_PER_UNIT[n_unit] - mm) > 1.0:
            raise Refused(f"record contradicts itself: {value} {unit} against normalized {normalized}")
    return mm


def allowed_mm(target_mm: float) -> float:
    return max(TOLERANCE_MM, TOLERANCE_RATIO * target_mm)


def dims_from_record(item_dimensions: dict, extent_mm: tuple[float, float, float]) -> tuple[dict, dict]:
    """The listing's integer w/d/h in mm, and which ABO field became which axis. The model's box decides w against d.

    Raises:
        Refused: a dimension is missing or unusable, or the model and the record disagree beyond the asset tolerance.
    """
    if not all(key in (item_dimensions or {}) for key in ("width", "length", "height")):
        raise Refused("the record has no complete item_dimensions")
    width, length, height = (to_mm(item_dimensions[key]) for key in ("width", "length", "height"))
    ex, ey, ez = extent_mm
    straight, swapped = abs(width - ex) + abs(length - ez), abs(length - ex) + abs(width - ez)
    (w, d), axes = ((width, length), {"w": "width", "d": "length"}) if straight <= swapped else ((length, width), {"w": "length", "d": "width"})
    for name, model, record in (("width", ex, w), ("height", ey, height), ("depth", ez, d)):
        if abs(model - record) > allowed_mm(record):
            raise Refused(f"{name}: the model is {model:.0f} mm, the record says {record:.0f} mm")
    return {"w": round(w), "d": round(d), "h": round(height)}, {**axes, "h": "height"}


def check_title(title: str, dims_mm: dict) -> None:
    """A size stated in the title, such as `83.5"W`, must agree with the record.

    Raises:
        Refused: the title states a width, depth or height more than 3% away from the record.
    """
    for number, axis in re.findall(r'(\d+(?:\.\d+)?)\s*(?:"|”|inch(?:es)?|in\.?)?\s*-?\s*([WDH])\b', title):
        stated, record = float(number) * 25.4, dims_mm[axis.lower()]
        if abs(stated - record) > TOLERANCE_RATIO * record:
            raise Refused(f'the title says {number}"{axis} ({stated:.0f} mm) but the record gives {record} mm')


def find_record(asin: str, meta: Path) -> tuple[dict, dict]:
    """The product's listing (amazon.com preferred) and its row in 3dmodels.csv.gz.

    Raises:
        FileNotFoundError: the ABO metadata is not under `meta`.
        Refused: the product is not in ABO, or has no 3D model.
    """
    found = []
    for path in sorted(meta.glob("listings_*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            found += [json.loads(line) for line in f if f'"{asin}"' in line]
    found = [item for item in found if item.get("item_id") == asin and item.get("3dmodel_id")]
    if not found:
        raise Refused(f"{asin} is not an ABO product with a 3D model")
    item = sorted(found, key=lambda candidate: candidate.get("domain_name") != "amazon.com")[0]
    with gzip.open(meta / "3dmodels.csv.gz", "rt", encoding="utf-8", newline="") as f:
        model = next((row for row in csv.DictReader(f) if row["3dmodel_id"] == item["3dmodel_id"]), None)
    if model is None:
        raise Refused(f"{asin} names a 3D model that 3dmodels.csv.gz does not list")
    return item, model


def english(values: list | None) -> str | None:
    for wanted in ("en_US", "en_GB", "en_CA", "en_AU", "en_IN"):
        for value in values or []:
            if value.get("language_tag") == wanted and isinstance(value.get("value"), str):
                return value["value"].strip()
    return None


def strip_extras(path: Path) -> list[str]:
    """Remove cameras, lights, animations and skins in place. Returns what was removed."""
    document, binary = read_glb(path)
    removed = [key for key in ("cameras", "animations", "skins") if document.pop(key, None)]
    if (document.get("extensions") or {}).pop("KHR_lights_punctual", None):
        removed.append("KHR_lights_punctual")
    for node in document.get("nodes", []):
        for key in ("camera", "skin"):
            node.pop(key, None)
        (node.get("extensions") or {}).pop("KHR_lights_punctual", None)
        if node.get("extensions") == {}:
            del node["extensions"]
    if document.get("extensions") == {}:
        del document["extensions"]
    for key in ("extensionsUsed", "extensionsRequired"):
        if key in document:
            document[key] = [name for name in document[key] if name != "KHR_lights_punctual"]
            if not document[key]:
                del document[key]
    write_glb(path, document, binary)
    return removed


def prepare_model(asin: str, model_row: dict, height_mm: int, work: Path) -> Path:
    """Download, strip, optimise and stand the model on the floor at its listed height. Returns the finished GLB.

    Raises:
        Refused: the optimised model is over the byte or triangle budget.
        subprocess.CalledProcessError: gltf-transform failed.
    """
    folder = work / asin
    folder.mkdir(parents=True, exist_ok=True)
    original, stripped, final = folder / "original.glb", folder / "stripped.glb", folder / "model.glb"
    if not original.exists():
        with urllib.request.urlopen(f"{BUCKET}/3dmodels/original/{model_row['path']}", timeout=600) as response, open(original, "wb") as f:
            f.write(response.read())
    stripped.write_bytes(original.read_bytes())
    removed = strip_extras(stripped)
    subprocess.run([*OPTIMIZE, str(stripped), str(final), *OPTIMIZE_FLAGS], check=True, capture_output=True, text=True)
    fit_to_height(final, height_mm / 1000)
    box = measure(final)
    print(f"model: {original.stat().st_size} -> {box['bytes']} bytes, {box['triangles']} triangles, removed {removed or 'nothing'}")
    if box["bytes"] > MAX_BYTES or box["triangles"] > MAX_TRIANGLES:
        raise Refused(f"over budget after optimising: {box['bytes']} bytes, {box['triangles']} triangles")
    return final


def check_model(path: Path, dims_mm: dict) -> dict:
    """The finished model against the listing, by the asset test's own rules. Returns the residual in cm.

    Raises:
        Refused: size, floor contact or centring is outside tolerance.
    """
    box = measure(path)
    measured = {"w": 1000 * box["size"][0], "h": 1000 * box["size"][1], "d": 1000 * box["size"][2]}
    for axis, value in measured.items():
        if abs(value - dims_mm[axis]) > allowed_mm(dims_mm[axis]):
            raise Refused(f"after processing, {axis} is {value:.0f} mm against the listing's {dims_mm[axis]} mm")
    centre = [500 * (box["min"][i] + box["max"][i]) for i in (0, 2)]
    if abs(1000 * box["min"][1]) > 10 or max(abs(c) for c in centre) > 20:
        raise Refused(f"not standing centred on the floor: min y {1000 * box['min'][1]:.0f} mm, centre {centre}")
    return {axis: round((measured[axis] - dims_mm[axis]) / 10, 2) for axis in ("w", "h", "d")}


def nearest_palette(hex_colour: str) -> str:
    return min(PALETTE, key=lambda candidate: sum((a - b) ** 2 for a, b in zip(_rgb(hex_colour), _rgb(candidate))))


def listing_for(asin: str, item: dict, args: argparse.Namespace, dims_mm: dict) -> dict:
    """The catalogue listing. Colours come from the seed palette, because test_scale.py requires exactly that.

    Raises:
        Refused: the record has no English name or no usable colour code.
    """
    name = english(item.get("item_name"))
    codes = [code for code in item.get("color_code") or [] if re.fullmatch(r"#[0-9a-fA-F]{6}", code)]
    if name is None or not codes:
        raise Refused("the record has no English name or no colour code")
    materials = [part.strip().lower() for part in re.split(r"[,;/]", english(item.get("material")) or "") if part.strip()]
    return {
        "id": f"abo-{asin}", "source": "abo", "title": re.sub(r"^Amazon Brand\s*[–-]\s*", "", name),
        "category": args.category, "price_cents": args.price_cents, "dims_mm": dims_mm,
        "model_url": f"/models/furniture/abo-{asin}/model.glb",
        "colour_hex": [nearest_palette(codes[0].lower())], "materials": materials[:4],
    }


def metadata_for(asin: str, item: dict, model_row: dict, listing: dict, axes: dict, residual_cm: dict, args: argparse.Namespace) -> dict:
    dims = listing["dims_mm"]
    return {
        "productId": f"abo-{asin}", "modelUrl": listing["model_url"],
        "widthCm": dims["w"] / 10, "depthCm": dims["d"] / 10, "heightCm": dims["h"] / 10,
        "assetUnits": "meters", "upAxis": "+Y", "frontAxis": "+Z", "pivot": "floor-footprint-center",
        "catalogueListingId": listing["id"],
        "matchType": "verified",
        "priceProvenance": args.price_provenance,
        "license": {**LICENSE, "changes": "Textures resized to 1024 px, mesh simplified and re-saved with gltf-transform; "
                                          "uniform scale to the listed height. Proportions untouched."},
        "source": {
            "dataset": "Amazon Berkeley Objects", "datasetUrl": f"{BUCKET}/index.html",
            "itemId": asin, "domain": item.get("domain_name"), "productName": english(item.get("item_name")),
            "modelFile": f"3dmodels/original/{model_row['path']}",
            "rawDimensions": {key: {"value": item["item_dimensions"][key]["value"], "unit": item["item_dimensions"][key]["unit"]}
                              for key in ("width", "length", "height")},
            "axisAssignment": axes,
            "colourCode": (item.get("color_code") or [None])[0],
            "processing": "scripts/abo_import.py: strip cameras/lights/animations, " + " ".join([*OPTIMIZE[2:], *OPTIMIZE_FLAGS]) + ", fit_to_height",
        },
        "residualCm": {"width": residual_cm["w"], "height": residual_cm["h"], "depth": residual_cm["d"]},
        "knownLimitations": [
            "ABO scaled this model to the record's item_dimensions; the record was cross-checked against the product title where the title states a size.",
            "The catalogue colour is the nearest of the 30 seed-palette colours to ABO's color_code, not the code itself.",
        ],
    }


def write_outputs(asin: str, model: Path, listing: dict, metadata: dict) -> None:
    """Asset folder plus one appended listing. Refuses to overwrite an existing listing id."""
    with open(LISTINGS, encoding="utf-8") as f:
        feed = json.load(f)
    if any(existing["id"] == listing["id"] for existing in feed["items"]):
        raise Refused(f"{listing['id']} is already in listings.json")
    folder = ASSETS / f"abo-{asin}"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "model.glb").write_bytes(model.read_bytes())
    with open(folder / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
        f.write("\n")
    feed["items"].append(listing)
    with open(LISTINGS, "w", encoding="utf-8") as f:
        json.dump(feed, f, indent=2, ensure_ascii=False)
        f.write("\n")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import one ABO product.")
    parser.add_argument("asin")
    parser.add_argument("--category", required=True, choices=CATEGORIES)
    parser.add_argument("--price-cents", required=True, type=int)
    parser.add_argument("--price-provenance", required=True, choices=("placeholder", "source"))
    parser.add_argument("--meta", type=Path, default=REPO / ".scratch" / "abo" / "meta")
    parser.add_argument("--work", type=Path, default=REPO / ".scratch" / "abo")
    parser.add_argument("--dry-run", action="store_true", help="do everything except write the asset folder and the listing")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        item, model_row = find_record(args.asin, args.meta)
        extent_mm = tuple(1000 * float(model_row[key]) for key in ("extent_x", "extent_y", "extent_z"))
        dims_mm, axes = dims_from_record(item.get("item_dimensions"), extent_mm)
        listing = listing_for(args.asin, item, args, dims_mm)
        check_title(english(item.get("item_name")) or "", dims_mm)
        model = prepare_model(args.asin, model_row, dims_mm["h"], args.work)
        residual_cm = check_model(model, dims_mm)
        if not args.dry_run:
            write_outputs(args.asin, model, listing, metadata_for(args.asin, item, model_row, listing, axes, residual_cm, args))
    except Refused as refusal:
        print(f"REFUSED {args.asin}: {refusal}", file=sys.stderr)
        return 1
    except FileNotFoundError as missing:
        print(f"ABO metadata not found: {missing}", file=sys.stderr)
        return 2
    except subprocess.CalledProcessError as failure:
        print(f"gltf-transform failed for {args.asin}: {failure.stderr[-400:]}", file=sys.stderr)
        return 1
    print(f"{'would import' if args.dry_run else 'imported'} {listing['id']}: {listing['title']} | {dims_mm} | residual cm {residual_cm}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
