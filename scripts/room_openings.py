#!/usr/bin/env python3
"""Measure a prepared room's glazing from its own model. Usage: python3 scripts/room_openings.py shared/rooms/<room-id>

Prints every node whose name mentions glass, window or door, with its world bounds in scene
centimetres, so the numbers in the room's openings.json can be checked against the file instead of
against a screenshot. Read-only. The room's GLB is licensed and not in Git; import it first.

Exit codes: 0 printed, 1 the room's placement is not a plain offset and scale (measure by hand),
2 bad arguments or missing files.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from api.glb import IDENTITY, _multiply, node_matrix, read_glb  # noqa: E402

WORDS = ("glass", "window", "door")


def world_bounds(document: dict, index: int, parent: list) -> tuple[list[float], list[float]]:
    """Bounds of a node and everything under it, from each POSITION accessor's min and max."""
    low, high = [math.inf] * 3, [-math.inf] * 3

    def visit(node_index: int, matrix: list) -> None:
        node = document["nodes"][node_index]
        world = _multiply(matrix, node_matrix(node))
        for primitive in document["meshes"][node["mesh"]]["primitives"] if "mesh" in node else []:
            accessor = document["accessors"][primitive["attributes"]["POSITION"]]
            for corner in ((x, y, z) for x in (accessor["min"][0], accessor["max"][0])
                           for y in (accessor["min"][1], accessor["max"][1]) for z in (accessor["min"][2], accessor["max"][2])):
                point = [sum(world[i][j] * value for j, value in enumerate((*corner, 1.0))) for i in range(3)]
                for axis in range(3):
                    low[axis], high[axis] = min(low[axis], point[axis]), max(high[axis], point[axis])
        for child in node.get("children", []):
            visit(child, world)

    visit(index, parent)
    return low, high


def glazing(document: dict) -> list[dict]:
    """Every matching node, outermost first; a match's descendants are covered by its own bounds."""
    found: list[dict] = []

    def visit(index: int, parent: list) -> None:
        node = document["nodes"][index]
        if any(word in node.get("name", "").lower() for word in WORDS):
            low, high = world_bounds(document, index, parent)
            found.append({"node": node["name"], "min_m": low, "max_m": high,
                          "own_transform": sorted(set(node) & {"rotation", "scale", "matrix"})})
            return
        world = _multiply(parent, node_matrix(node))
        for child in node.get("children", []):
            visit(child, world)

    for root in document["scenes"][document.get("scene", 0)]["nodes"]:
        visit(root, IDENTITY)
    return found


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not (Path(argv[1]) / "manifest.json").is_file():
        print(__doc__, file=sys.stderr)
        return 2
    room_dir = Path(argv[1])
    with open(room_dir / "manifest.json", encoding="utf-8") as handle:
        scan = json.load(handle)["room"]["scan"]
    model = room_dir / "assets" / Path(scan["visualUrl"]).name
    if not model.is_file():
        print(f"{model} is missing: import the room's licensed assets first", file=sys.stderr)
        return 2
    if any(scan["rotationDeg"]):
        print("the manifest rotates the model; scene axes are not model axes, so measure by hand", file=sys.stderr)
        return 1
    document, _ = read_glb(model)
    for entry in glazing(document):
        to_cm = lambda metres, axis: round(100 * scan["scale"] * metres + scan["positionCm"][axis], 1)
        low, high = ([to_cm(value, axis) for axis, value in enumerate(entry[key])] for key in ("min_m", "max_m"))
        print(f"{entry['node']!r}: x {low[0]}..{high[0]} cm, z {low[2]}..{high[2]} cm, y (sill..head) {low[1]}..{high[1]} cm"
              + (f"  [own {', '.join(entry['own_transform'])}]" if entry["own_transform"] else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
