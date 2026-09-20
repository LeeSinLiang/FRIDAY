"""Measure and correct a GLB without a 3D library. Standard library only.

Used by the furniture asset check (see test_furniture_assets.py): an asset's bounding box must agree
with its listing, because a generator that normalises to a unit cube, or an export in centimetres,
renders furniture at the wrong size without any error.
"""
import json
import math
import struct
from pathlib import Path

GLB_MAGIC = b"glTF"
JSON_CHUNK = b"JSON"
BIN_CHUNK = b"BIN\x00"
IDENTITY = [[1.0 if row == column else 0.0 for column in range(4)] for row in range(4)]


def read_glb(path: Path) -> tuple[dict, bytes]:
    """Return the glTF document and its binary chunk.

    Raises:
        ValueError: the file is not a version 2 GLB.
    """
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != GLB_MAGIC or version != 2:
        raise ValueError(f"{path} is not a glTF 2 binary")
    offset, document, binary = 12, None, b""
    while offset < length:
        size, kind = struct.unpack_from("<I4s", data, offset)
        body = data[offset + 8: offset + 8 + size]
        offset += 8 + size
        if kind == JSON_CHUNK:
            document = json.loads(body)
        elif kind == BIN_CHUNK:
            binary = body
    if document is None:
        raise ValueError(f"{path} has no JSON chunk")
    return document, binary


def write_glb(path: Path, document: dict, binary: bytes) -> None:
    """Write a GLB. Chunks are padded to four bytes as the format requires: JSON with spaces, BIN with zeros."""
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary += b"\x00" * (-len(binary) % 4)
    total = 12 + 8 + len(encoded) + (8 + len(binary) if binary else 0)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", GLB_MAGIC, 2, total))
        f.write(struct.pack("<I4s", len(encoded), JSON_CHUNK) + encoded)
        if binary:
            f.write(struct.pack("<I4s", len(binary), BIN_CHUNK) + binary)


def _multiply(a: list, b: list) -> list:
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def node_matrix(node: dict) -> list:
    """A node's local transform as a row-major 4x4, from its matrix or its translation, rotation and scale."""
    if "matrix" in node:
        m = node["matrix"]  # glTF stores matrices column-major
        return [[m[column * 4 + row] for column in range(4)] for row in range(4)]
    tx, ty, tz = node.get("translation", [0, 0, 0])
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = node.get("scale", [1, 1, 1])
    rotation = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    scale = (sx, sy, sz)
    return [[rotation[i][j] * scale[j] for j in range(3)] + [(tx, ty, tz)[i]] for i in range(3)] + [[0, 0, 0, 1]]


def measure(path: Path) -> dict:
    """World-space bounds in metres, triangle count and file size.

    Bounds come from each POSITION accessor's min and max, which glTF requires, carried through the
    node hierarchy. For rotated nodes that is the box of the box: never too small, which is the safe
    direction for a fit check.
    """
    document, _ = read_glb(path)
    low, high, triangles = [math.inf] * 3, [-math.inf] * 3, 0

    def visit(index: int, parent: list) -> None:
        nonlocal triangles
        node = document["nodes"][index]
        world = _multiply(parent, node_matrix(node))
        for primitive in document["meshes"][node["mesh"]]["primitives"] if "mesh" in node else []:
            accessor = document["accessors"][primitive["attributes"]["POSITION"]]
            counted = document["accessors"][primitive["indices"]] if "indices" in primitive else accessor
            triangles += counted["count"] // 3
            for corner in ((x, y, z) for x in (accessor["min"][0], accessor["max"][0])
                           for y in (accessor["min"][1], accessor["max"][1]) for z in (accessor["min"][2], accessor["max"][2])):
                point = [sum(world[i][j] * value for j, value in enumerate((*corner, 1.0))) for i in range(3)]
                for axis in range(3):
                    low[axis], high[axis] = min(low[axis], point[axis]), max(high[axis], point[axis])
        for child in node.get("children", []):
            visit(child, world)

    for root in document["scenes"][document.get("scene", 0)]["nodes"]:
        visit(root, IDENTITY)
    return {"min": low, "max": high, "size": [high[i] - low[i] for i in range(3)],
            "triangles": triangles, "bytes": Path(path).stat().st_size}


def fit_to_height(path: Path, height_m: float) -> dict:
    """Scale a GLB UNIFORMLY so it is `height_m` tall, centre its footprint on the origin and stand it on y = 0.

    Lossless: no vertex, index or texture byte changes. The existing scene roots are re-parented under
    one new root node that carries the transform, so whatever transforms the asset already had are kept.
    Uniform scale only. Squashing a model to force its box to match a listing is invisible on a chair
    and grotesque on a sofa or a lamp; the asset check allows for the small mismatch instead.

    Returns:
        The scale and translation applied.
    """
    before = measure(path)
    scale = height_m / before["size"][1]
    centre_x, centre_z = (before["min"][0] + before["max"][0]) / 2, (before["min"][2] + before["max"][2]) / 2
    translation = [-centre_x * scale, -before["min"][1] * scale, -centre_z * scale]
    document, binary = read_glb(path)
    scene = document["scenes"][document.get("scene", 0)]
    document["nodes"].append({"name": "friday_fit_root", "children": scene["nodes"], "scale": [scale] * 3, "translation": translation})
    scene["nodes"] = [len(document["nodes"]) - 1]
    write_glb(path, document, binary)
    return {"scale": scale, "translation": translation}
