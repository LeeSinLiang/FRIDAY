"""DEV STUB — Saketh. A hardcoded room so place[] refs resolve before the real Room exists.

Delete this file when the space lane ships its Room; keep the ids' shape identical.
4200 x 3600 mm rectangle, origin at the south-west corner, x east, y north.
"""

MOCK_ROOM: dict = {
    "id": "mock-room-1",
    "source": "built",
    "floor_polygon_mm": [[0, 0], [4200, 0], [4200, 3600], [0, 3600]],
    "walls": [
        {"id": "w-n", "label": "north wall", "a": [0, 3600], "b": [4200, 3600], "height_mm": 2400},
        {"id": "w-e", "label": "east wall", "a": [4200, 3600], "b": [4200, 0], "height_mm": 2400},
        {"id": "w-s", "label": "south wall", "a": [4200, 0], "b": [0, 0], "height_mm": 2400},
        {"id": "w-w", "label": "west wall", "a": [0, 0], "b": [0, 3600], "height_mm": 2400},
    ],
    "openings": [
        {"id": "d1", "wall_id": "w-w", "kind": "door", "start_mm": 600, "width_mm": 900, "swing_mm": 900},
        {"id": "w1", "wall_id": "w-n", "kind": "window", "start_mm": 1300, "width_mm": 1600},
    ],
    "placed": [
        {"instance_id": "sofa-1", "listing_id": "ikea-291.292.29", "label": "EKTORP 3-seat sofa",
         "position_mm": [2100, 500], "rotation_y": 0, "pinned": False},
        {"instance_id": "lamp-1", "listing_id": "ikea-805.109.92", "label": "HEKTAR floor lamp",
         "position_mm": [3900, 3300], "rotation_y": 0, "pinned": False},
    ],
}


def room_refs(room: dict) -> dict[str, list[dict]]:
    """The ids a Program may reference. This, not the geometry, is what compile() is given."""
    openings = room["openings"]
    return {
        "walls": [{"id": wall["id"], "label": wall["label"]} for wall in room["walls"]],
        "windows": [{"id": o["id"], "wall_id": o["wall_id"]} for o in openings if o["kind"] == "window"],
        "doors": [{"id": o["id"], "wall_id": o["wall_id"]} for o in openings if o["kind"] == "door"],
        "instances": [{"id": p["instance_id"], "label": p["label"]} for p in room["placed"]],
    }
