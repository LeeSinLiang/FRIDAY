# Skyscraper floors in the existing editor

The London skyscraper is a separate public gallery room at `/room/london-skyscraper-test`. The existing editor, catalogue, Floor plan, Walk, furniture tools and map keep their current UI. The map's existing up/down arrows select the adjacent floor. `?floor=C20` opens a particular prepared level; an unknown floor falls back to the requested valid context.

## Model and preparation

The one tracked `shared/rooms/london-skyscraper-test/assets/building.glb` contains the complete unfurnished source: 58 meshes, 141,583 triangles, 18 materials and 45 embedded images. Its SHA-256 is `0d4d516057aa6b8e6a79cdbd0b3446432edd831a151206c2c1879e944dc87de9`. Textures, materials and geometry are copied unchanged. Source: [99.Miles, Free London Skyscraper](https://sketchfab.com/3d-models/free-london-skyscraper-52b73f6ea18a440cb42734840d5edc72), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the public Sketchfab v3 API confirmed creator/license on 2026-09-20. William removed Furniture and Lobby_Furniture from the downloaded source; the license files retain that modification notice.

Reproduce the metadata from the supplied edited source with:

```bash
uv run --with numpy --with shapely python scripts/skyscraper/prepare.py /absolute/path/London_Skyscraper_Unfurnished.glb
BACKEND_PORT=8234 FRONTEND_PORT=5234 ./run-local.sh
```

Open `http://127.0.0.1:5234/rooms`, select the skyscraper, use the existing floor arrows and add furniture normally. Stop the task's stack with Ctrl-C. `shared/skyscraper-test-scene.json` holds the reference dimensions/pose and all measured floor records for repeatable engine/agent tests; no reference object or technical panel is automatically added to a user's room.

## Geometry boundary

There are 32 individually measured levels, C01–C32, from source Y=7.180015564 m to 145.231170654 m. The metadata records each actual top surface; it assumes neither equal storey spacing nor equal slab thickness. Candidate IDs are not certified architectural storey numbers. Source glTF metres become centimetres and then engine units through the existing unit conversion, without fitting the building to a bounding box.

Each level currently enables the source-space rectangle X=4…8 m, Z=−12…−4 m: 32 m², local X=50…450 cm and Z=50…850 cm, with 230 cm checked clearance. This is a bounded placement/navigation zone within each floor, not the whole storey. Complete triangle-union coverage detects gaps between samples. All 32 zones have zero unsupported area; C01's planar approximation leaves at most 2.533 mm of support gap and the others are flat. Triangles crossing the occupied height band, including vertical walls buffered by 3 cm, produce conservative obstacle rectangles. C20–C29 each contain an approximately 0.448 m² wall projection; those locations reject furniture and walking. No general arbitrary-mesh collision or stair traversal is claimed.

## Engine, persistence and agent references

`room.scan.building` carries building ID, source hash, floor ID, surface ID, measured elevation, source origin, clearance and ordered level room IDs. Each floor remains an ordinary independent room context for validation, saving, revisions, undo and capture. Switching waits for pending edits; it clears selection, exits pointer lock, fetches the next context and resets the camera. The loaded GLB, textures and materials are reused. A capture must finish restoring its camera before the floor transform changes; each worker remains bound to its own room/revision. Single-room navigation and all shopping/account/payment code are unchanged.

Use `api.engine_tools.get_scene_context(session_key, room_id)` to read authoritative products, instances, revisions and floor metadata. A trusted adapter supplies the session identity. Pass the same explicit room ID to `try_place` and capture tools. This SDK-independent reader is not installed in the separate shopping compiler. Poses remain `{xCm,zCm,yawRad}` on each floor: lamp-on-table and cabinet attachment are later work, as described in the [supported placement plan](../3d-object/supported-placement-mvp-plan.md).

## Packaging and verification

The public gallery has one building entry. Floor manifests share the owner's exact visual URL, with no alias chains or path escapes. Vite emits the GLB once; the backend build follows declared floor IDs to package all 32 manifest/spatial pairs, without copying visual assets or private runtime data. `.gitignore` and `.vercelignore` permit only this licensed building asset.

Automated checks cover all 32 floor contexts, independent persistence, reference placement/edge rejection, irregular heights, asymmetric upper-floor wall acceptance/rejection, unchanged ordinary-room selection, renderer reuse, capture guards and production metadata packaging. Local full checks: `manage.py test` → `Ran 267 tests in 10.219s / OK (skipped=5)`; `npm test` → `147 + 18 passed, 0 failures`; `npm run build` → `built in 2.95s`. Browser and production acceptance are recorded in TODO_WILLIAM.md. Screenshots/logs live under ignored `.scratch/skyscraper-research/`.

This replaces the earlier three-floor technical test panel. The old screenshots remain historical evidence only; the current UI has no test panel, exterior-view button or extra floor selector.
