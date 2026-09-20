#!/usr/bin/env python3
"""Choose which Amazon Berkeley Objects products are worth importing, and write the plan for abo_batch.py.

Usage, from backend/:
  uv run python ../scripts/abo_select.py --out ../.scratch/abo/plan.json [--meta ../.scratch/abo/meta]

Being picky is free: about 8,000 products have a model and a living room needs fifty. A product is kept only if
- its dimensions parse with their unit and its model agrees with them (abo_import.dims_from_record),
- its TITLE states a size that agrees with the record (abo_import.require_title_size). ABO scaled its models to
  the record, so a wrong record gives a wrongly sized model that agrees with itself; the title is the only
  independent witness, and a product whose title states no size is skipped rather than eyeballed,
- its title says plainly what it is. ABO's CHAIR type mixes armchairs, dining chairs and ottomans, and an
  ottoman among the armchairs is exactly what a judge notices.
One product per distinct size (colour variants share a mesh, and a shelf of one chair in five colours is padding). The plan lists spares after each quota, because
the importer can still refuse a product once it has the real file (over budget, not floor-standing).

Exit codes: 0 plan written, 2 ABO metadata missing.
"""
import argparse
import csv
import gzip
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from abo_import import REPO, Refused, dims_from_record, product_name, require_title_size  # noqa: E402

# category -> (quota, ABO product types searched, title must match, title must not match)
RULES: dict[str, tuple[int, tuple[str, ...], str, str]] = {
    "armchair": (11, ("CHAIR",), r"accent chair|arm ?chair|living room chair|lounge chair|club chair|wingback|swivel chair|barrel chair|slipper chair|reading chair",
                 r"ottoman|stool|bench|dining|kitchen|office|desk|bar\b|counter|folding|outdoor|patio|kids|cover|cushion"),
    "chair": (4, ("CHAIR",), r"dining chair|dining room chair|kitchen chair|side chair", r"ottoman|stool|bench|office|bar\b|counter|outdoor|patio|kids|cover|cushion|set of"),
    "table": (10, ("TABLE",), r"coffee table|side table|end table|accent table|console table|nesting|cocktail table|sofa table",
              r"dining|desk|cabinet|media|tv\b|outdoor|patio|kids|cover|lamp|ottoman"),
    "sofa": (8, ("SOFA",), r"sofa|couch|loveseat|sectional|settee", r"ottoman|cover|slipcover|outdoor|patio|kids|cushion|table"),
    "lamp": (8, ("LAMP", "LIGHT_FIXTURE"), r"floor lamp|table lamp|desk lamp", r"pendant|ceiling|sconce|wall|chandelier|outdoor|string"),
    "shelf": (5, ("SHELF", "DESK", "HOME_FURNITURE_AND_DECOR", "CABINET", "FURNITURE", "HOME"), r"bookcase|bookshelf|shelving unit|etagere|ladder shelf|storage shelf|open shelf",
              r"floating|wall|mount|outdoor|kids|shower|closet|shoe"),
    "decor": (4, ("VASE",), r"vase", r"set of|faux|artificial|flower arrangement"),
}
# One model is one object. A "Pack of 2" listing placed as a single chair would claim two.
MULTIPACK = r"pack of|\d\s*-?\s*pack\b|set of|pair of|\d\s*-?\s*piece"
SPARES = 1.0  # as many spares again as the quota
MAX_FACES = 100000  # the simplifier often brings these under the 30,000 triangle budget; the importer checks the result


def records(meta: Path):
    """Every ABO listing that names a 3D model, the amazon.com listing first when a product has several."""
    found: dict[str, dict] = {}
    for path in sorted(meta.glob("listings_*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                if '"3dmodel_id"' not in line:
                    continue
                item = json.loads(line)
                held = found.get(item["item_id"])
                if held is None or (held.get("domain_name") != "amazon.com" and item.get("domain_name") == "amazon.com"):
                    found[item["item_id"]] = item
    return found.values()


def category_of(item: dict, title: str) -> str | None:
    product_type = item.get("product_type")
    product_type = product_type[0].get("value") if isinstance(product_type, list) and product_type else product_type
    if re.search(MULTIPACK, title, re.IGNORECASE):
        return None
    for category, (_, types, wanted, unwanted) in RULES.items():
        if product_type in types and re.search(wanted, title, re.IGNORECASE) and not re.search(unwanted, title, re.IGNORECASE):
            return category
    return None


def candidate(item: dict, models: dict[str, dict], skipped: Counter) -> dict | None:
    """One plan row, or None with the reason counted."""
    model = models.get(item.get("3dmodel_id", ""))
    try:
        if model is None or item.get("domain_name") != "amazon.com":
            raise Refused("no model row, or not an amazon.com listing")
        title = product_name(item)
        category = category_of(item, title)
        if category is None:
            raise Refused("title does not say plainly what it is")
        if int(model["faces"] or 0) > MAX_FACES:
            raise Refused("too many faces to simplify reliably")
        extent_mm = tuple(1000 * float(model[key]) for key in ("extent_x", "extent_y", "extent_z"))
        dims_mm, _ = dims_from_record(item.get("item_dimensions"), extent_mm)
        confirms = require_title_size(title, dims_mm)
    except Refused as reason:
        skipped[str(reason).split(":")[0][:60]] += 1
        return None
    return {"asin": item["item_id"], "category": category, "title": title, "dims_mm": dims_mm, "title_confirms": confirms,
            "faces": int(model["faces"]), "has_colour_code": bool(item.get("color_code")),
            "shape": [dims_mm["w"], dims_mm["d"], dims_mm["h"]]}


def plan_from(rows: list[dict]) -> list[dict]:
    """Quota plus spares per category, one product per distinct size, simplest meshes first."""
    plan, seen = [], set()
    for category, (quota, *_rest) in RULES.items():
        chosen = []
        for row in sorted((r for r in rows if r["category"] == category), key=lambda r: (not r["has_colour_code"], r["faces"], r["asin"])):
            shape = tuple(row["shape"])
            if shape in seen:
                continue
            seen.add(shape)
            chosen.append({**row, "role": "quota" if len(chosen) < quota else "spare"})
            if len(chosen) >= quota + round(quota * SPARES):
                break
        plan += chosen
    return plan


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Select ABO products to import.")
    parser.add_argument("--meta", type=Path, default=REPO / ".scratch" / "abo" / "meta")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        with gzip.open(args.meta / "3dmodels.csv.gz", "rt", encoding="utf-8", newline="") as f:
            models = {row["3dmodel_id"]: row for row in csv.DictReader(f)}
    except FileNotFoundError as missing:
        print(f"ABO metadata not found: {missing}", file=sys.stderr)
        return 2
    skipped: Counter = Counter()
    rows = [row for row in (candidate(item, models, skipped) for item in records(args.meta)) if row]
    plan = plan_from(rows)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"quotas": {category: rule[0] for category, rule in RULES.items()}, "items": plan}, f, indent=1, ensure_ascii=False)
    print("passed every gate, by category:", dict(Counter(row["category"] for row in rows)))
    print("skipped:", dict(skipped.most_common(8)))
    for row in plan:
        print(f"{row['role']:5} {row['category']:9} {row['asin']} {row['dims_mm']['w']:>5}x{row['dims_mm']['d']:>5}x{row['dims_mm']['h']:>5} mm  "
              f"faces {row['faces']:>6}  title confirms {row['title_confirms']}  | {row['title'][:90]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
