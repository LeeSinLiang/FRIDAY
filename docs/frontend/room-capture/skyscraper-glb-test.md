# Skyscraper floors in the existing editor

The gallery opens `/room/london-skyscraper` at the actual **entrance lobby**. The existing map arrows traverse 34 contexts: entrance lobby G00, lobby mezzanine M00, then 32 tower floors C01–C32. `?floor=C20` opens tower floor 20 (the 22nd context). The editor, category rail, Floor plan, Walk, furniture tools and jump/gravity keep their existing controls.

## Model and preparation

The tracked `shared/rooms/london-skyscraper-test/assets/building.glb` is the complete unfurnished source: 58 meshes, 141,583 triangles, 18 materials and 45 embedded images. SHA-256: `0d4d516057aa6b8e6a79cdbd0b3446432edd831a151206c2c1879e944dc87de9`. The source textures, materials and geometry are unchanged; the scoped runtime rendering adjustments are described below. Source: [99.Miles, Free London Skyscraper](https://sketchfab.com/3d-models/free-london-skyscraper-52b73f6ea18a440cb42734840d5edc72), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The public Sketchfab v3 API confirmed creator/license on 2026-09-20. William removed Furniture and Lobby_Furniture from the source; the license files retain that modification notice.

```bash
uv run --with numpy --with shapely python scripts/skyscraper/prepare.py /absolute/path/London_Skyscraper_Unfurnished.glb
BACKEND_PORT=8234 FRONTEND_PORT=5234 ./run-local.sh
```

Open `http://127.0.0.1:5234/rooms`, select the skyscraper, and use the existing floor arrows. Stop the task's stack with Ctrl-C. `shared/skyscraper-test-scene.json` records source identity, elevations, origins, areas and a supported pose for a 2×1×1 m reference on each floor. No reference object is inserted into public scenes.

## Corrected geometry and visual acceptance

[Issue #89](https://github.com/LeeSinLiang/hackmit2026/issues/89) records two mistakes in the first release: an Interior_Top-only filter omitted the lobby, and every floor used a 4×8 m test rectangle. The original tests agreed with those assumptions. Comparison against the real mesh and editor exposed the mismatch.

The entrance is at source Y=−4.21677 m, the mezzanine at −0.20950 m, and the first tower slab at 7.18002 m. Named **Lobby_Floor** geometry separates interior floor from sidewalk at the same height. Each tower elevation remains independently measured, up to 145.23117 m; no equal storey/slab assumption is used. Minimap outlines now follow the actual floor triangle union, including holes, and remain visible as the map rotates. Floor plan uses the same outline and clear-area coordinates.

Preparation subtracts projected fixed geometry intersecting the occupied height band from the supported floor polygon, with a 2.5 cm margin. Only cells whose entire area is covered are accepted; adjacent cells are merged into the existing rectangle-union collision contract. This avoids changing the movement or placement algorithms. Resolution is 20–40 cm as recorded per floor, bounded to 256 rectangles. Boundary cells, stairs, voids and blocked areas stay excluded. Both the frontend and backend validate the complete furniture footprint across rectangle seams.

The lobby has 245.70 m² of checked clear area and the mezzanine 57.28 m². Tower clear areas range from 461.08 to 1,071.38 m², with distinct outlines as the tower widens and narrows. The outline describes the exact source floor; the usable area is a conservative inset. All generated areas have zero unsupported/blocked overlap to a 1e−6 m² tolerance. Flat placement approximates source surface variation by at most 29.37 mm; checked clearance is 300 cm in the lobby, 500 cm on the mezzanine, and independently measured on each tower floor. These are authored model dimensions, not a physical survey. Stairs and arbitrary mesh collision are not implemented.

Visual checks on the actual editor:

- Entrance lobby and mezzanine show their distinct source geometry and correct height difference, using the existing arrows.
- Lobby chair at local (1620,500) dragged to (1670,500), revision 3→4. A subsequent drag to approximately (1870,500), outside the slanted mesh edge but inside its bounding rectangle, reported **Unverified area**; pose and revision stayed unchanged. The small target is off centre, so a mirrored boundary cannot pass this check.
- C20's much wider full-floor outline and interior wall gaps agree with the mesh geometry plot. Reference and floor persistence remain isolated by room ID.

Screenshots and raw logs live under ignored `.scratch/skyscraper-research/`: `boundary-diagnosis.png`, `corrected-entrance.png`, `corrected-mezzanine.png`, `corrected-lobby-inside.png`, `corrected-lobby-outside-rejected.png`, and `corrected-tower-c20-plan.png`. Production acceptance is recorded in TODO_WILLIAM.md.

## Walking and rendering

Normal/fast walking is 360/540 cm/s (previously 240/360). Gravity, jump impulse, landing on furniture and the 10 cm ceiling margin are unchanged. All 34 current floor contexts permit the full approximately 90 cm jump above the 170 cm standing eye height; preparation checks the entire declared headroom for accepted cells instead of declaring an arbitrary 230 cm ceiling. True ceilings still limit jumps from raised objects.

`playcanvas/skyscraperLook.ts` applies only to the exact source GLB hash. It adds ACES tone mapping, a daylight sky/environment reflection atlas, directional shadows, up to 8× anisotropic filtering and a maximum 2× device pixel ratio. The source glass opacity images are entirely opaque despite BLEND materials; runtime opacity factors of 0.12/0.30 restore visibility through those windows while retaining their textures, normal maps and tint. Other rooms retain their existing lighting. This improves the supplied mesh; it does not create a London city backdrop or reconstruct missing detail.

The unchanged 1K HDR environment is [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), Greg Zaal / Jarod Guest, [CC0](https://polyhaven.com/license), shipped with attribution in `frontend/public/environments/license.txt`. No postprocessing framework or engine dependency was added.

Actual local browser capture jobs completed both 960×720 photographic and schematic captures with no error. The schematic capture uses the same outline and holes; a photographic capture from Floor plan restored the prior editor view. Evidence: `agent-perspective.png`, `agent-top.png`, `daylight-entrance.png`, `daylight-mezzanine.png`, and jump screenshots under `.scratch/skyscraper-research/`.

## Persistence and agent references

Each corrected floor has a new room ID (`london-skyscraper`, `london-skyscraper-level-m00`, `london-skyscraper-level-c01`…`c32`). The former `london-skyscraper-test` and `london-skyscraper-c02`…`c32` contexts are retained unchanged for existing saved scenes/cart links. They remain the old bounded test areas; they are not the current gallery entry. Existing persistence intentionally rejects changed coordinate systems under the same room ID, so no layout data is moved, deleted or silently reinterpreted.

`room.scan.building` carries source identity, floor/surface ID, source origin, elevation, clear area and ordered level IDs. Each context uses ordinary revisions, undo and capture. Switching waits for pending edits, clears unconfirmed catalogue preview/selection, exits pointer lock, fetches the next context and resets the camera. The GLB and materials are reused after capture restoration.

Trusted adapters call `api.engine_tools.get_scene_context(session_key, room_id)` and use that same explicit room ID for placement/capture. This reader is not installed in the separate shopping compiler. Poses remain `{xCm,zCm,yawRad}` on each floor; table/cabinet attachment is later work in the [supported placement plan](../3d-object/supported-placement-mvp-plan.md).

## Packaging and regression checks

There is one current gallery entry and one shipped building GLB. All current/legacy contexts share that canonical asset. Backend packaging follows the explicitly declared level and legacy IDs (227 runtime JSON files, including the existing Haussmann homepage context), with no model, capture or private data copies. Existing scene/cart/account/payment and jump/gravity implementations remain unchanged; walking speed is intentionally increased by 1.5×.

After correction: `manage.py test` → **Ran 269 tests in 12.271s / OK (skipped=5)**; `npm test` → **155 + 18 passed, 0 failures**; `npm run build` → **built in 3.23s**. Tests cover the entrance/mezzanine order, measured transforms, off-centre slanted-edge rejection, all-floor reference persistence, old layout coordinates, ordinary room routing and production metadata closure.

The old three-floor technical panel and 32-zone screenshots are historical evidence only. The current editor has no test panel, exterior-view button or new floor selector.
