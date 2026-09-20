# Empty Interior Scene 2: inaccessible connected floor

Owner: William · Status: integrated into the local app on port 5173 · Release branch: `codex/room-release-from-5173`

## Symptom and diagnosis

The visible Cg Arch corridor cannot be entered. The current room fixture allows only a 3.34 × 5.80 m living-room rectangle; walking and furniture use that same restriction. The rendered GLB has additional connected floor. This is a prepared spatial-data problem, not a missing model or keyboard-speed problem.

Inspected source: `room.glb`, SHA-256 `f5f5ab5566ee040c400faeb8ae66ff00e8d3d12a4db1836aa312e9feb903a59c`. It contains 560,458 triangles. An initial geometry projection finds approximately 38 m² of clear connected floor and about 37 m² fully covered by conservative 5 cm cells. The disconnected areas beyond closed walls/doors are not enabled.

## Plan

1. Reuse existing offline GLB parsing and rectangle-union utilities; derive supported ground floor and exclude geometry intersecting body height, retaining thin barriers.
2. Verify complete cells against support and obstacles, keeping only the component reachable from the starting camera. Record source hash, extent, clearance and zero unsupported/blocked area.
3. Update only Cg Arch spatial metadata. Preserve the previous permitted rectangle, after proving it remains clear. Add narrowly scoped compatibility for this reviewed expansion so existing instances and cart references are retained; all other geometry conflicts still reject.
4. Run regressions for off-centre corridor access, closed doors, cabinets and outside bounds; retained layouts; new placements; reload; and other rooms. Verify the real browser walking workflow and screenshot it before calling the issue fixed.

## Risks and rollback

The prepared model is authored, not a surveyed scan. Do not infer unseen rooms or force an open passage through a closed door. The licensed source stays local and byte-identical. Existing saved furniture is validated before accepting the known geometry expansion; no layouts are deleted. Reverting after a geometry upgrade requires a compatible metadata rollback, not silently rewriting saved coordinates.

## Verification

Baseline main `9adbf97`: backend `Ran 281 tests in 11.902s / OK (skipped=5)`; frontend `pass 181` and `pass 25`, both `fail 0`; build `built in 3.29s`. Screenshots and measurements are under `.scratch/cg-boundaries/`. This baseline and the initial browser proof were recorded in the isolated runtime; the subsequent local integration is recorded below.

This is a local ticket for a scoped side-conversation fix. The user subsequently requested integration into the app at `http://127.0.0.1:5173/rooms`.


## Implemented scope

- `scripts/prepare_cg_arch_boundaries.py` reuses the existing GLB triangle reader and conservative rectangle cover. The exact source hash is required. It reviews horizontal ground support, projects body-height geometry including thin glass/partitions, and keeps the component reachable from the initial camera.
- `shared/rooms/cg-arch-interior/spatial.json` now contains 21 rectangles covering 36.730 m², versus 19.372 m² before. `boundary-review.json` records zero unsupported area, zero obstacle overlap and zero lost legacy area. A conservative clearance check proves connectivity for the 40 cm walker to the corridor and entry.
- The existing map and floor-plan renderers consume `scan.floorOutlineCm` generated from that same union. No new controls or renderer logic. The room note in `SplatEditor.tsx` now names the living room, corridor and entry.
- The window remains at model X806.5–1086.5 cm. Its wall-relative offset changes to 786.5 cm because the connected floor starts at X20. Closed glass doors remain barriers.
- `backend/api/scene_service.py` recognizes only the reviewed Cg Arch v1→v2 transition. It validates saved instances, then updates only the geometry revision using a compare-and-set. Instance poses, layout revision, timestamps, cart references and command receipts are retained. Unknown transitions and invalid stored layouts still reject; historical command retries retain their original response.
- Region tests now exercise the L-shaped room. Existing exact rectangle arithmetic and portal regressions keep their explicit historical fixture. Walking code, other room metadata, rendering/materials, checkout and authentication are unchanged.

## Final verification

- `OPENAI_API_KEY= DEEPGRAM_API_KEY= ELASTIC_URL= ELASTIC_API_KEY= COMPILE_LIVE_TEST=0 .venv/bin/python manage.py test` (backend): `Ran 284 tests in 12.794s / OK (skipped=4)`. One optional test now runs because the licensed GLB is present; three new persistence/placement tests were added.
- `npm test` (frontend): `tests 181 / pass 181 / fail 0`, then `tests 25 / pass 25 / fail 0`. The count stays 181 because two obsolete live-rectangle assertions were consolidated into one current solver test, and a walking regression was added. Historical portal counts still pass.
- `npm run build`: `built in 3.58s`. An initial test JSON tuple cast failed TypeScript and was corrected before this successful build. Existing bundle-size warnings remain.
- `uv run --with numpy --with shapely python scripts/prepare_cg_arch_boundaries.py`: all spatial data, outline and source checks pass without writes.
- Browser keyboard walking crossed the previous X787 cutoff: spawn (1100,735) → corridor (363.43,460.49) → entry turn (40.01,461.60). Forward movement stopped at the actual northern barrier. The pure navigation regression separately walks a clear route to (80,650) and back. The southward browser return met a cabinet corner; its screenshot is contact evidence, not a completed return claim.
- Browser furnishing: placed a HERRÅKRA GLB at (600,490), dragged it to (500,490), rejected a drag into the cabinet around (500,650), reloaded and read saved (500,490) from the UI. Then the existing position controls accepted the entry alcove at (85,650). Screenshots: `corridor-chair-dragged.png`, `corridor-chair-reloaded.png`, `entry-chair.png`, `walking-corridor.png`, `walking-entry-turn.png`.
- The initial localhost persistence check hit competing local-development cookies. A dedicated `cg-arch-review.localhost` session fixed test isolation; no cookie/auth code was changed. Browser error log was empty.
- Canonical `./run-local.sh` served ports 8242/5242 from this worktree, verified by process working directories. Served room JSON exactly matched the new manifest/spatial files; the served editor contained the updated room note. Source, served and built GLB hashes all equal the source hash above. All model bytes and textures are unchanged.
- Closed the test tab, stopped both owned server processes, and checked `lsof`: no listeners on 8242 or 5242. Other tasks' servers were left running.

## Reproduction and handoff

After provisioning the unchanged licensed `shared/rooms/cg-arch-interior/assets/room.glb`, run the generator without flags to check it. Use `--write` only to regenerate this reviewed fixture. Old room bundles compare metadata byte-for-byte, so repack a bundle with the current metadata rather than replacing these new files with a v1 bundle.

```bash
BACKEND_PORT=8242 FRONTEND_PORT=5242 DJANGO_ALLOWED_HOSTS=cg-arch-review.localhost,localhost,127.0.0.1 ./run-local.sh
```

Open `http://cg-arch-review.localhost:5242/?room=cg-arch-interior`. The isolated hostname prevents guest identity collisions with other development databases.

## Local release integration, 2026-09-20

Integrated boundary commit `7a0ae0e` into gallery release `964f7e8` in `/Users/williamxu/Desktop/Projects/hackmit2026-fresh`, branch `codex/room-release-from-5173`. The only merge conflict was the task board; both task records were retained. The gallery component, public-room list and Cg Arch preview image are unchanged from the release. The existing Cg Arch preparation guide and its index entry now describe the expanded coverage.

- Before integration: full backend `Ran 281 tests in 13.515s / OK (skipped=4)`; frontend `tests 181 / pass 181 / fail 0`, then `tests 25 / pass 25 / fail 0`; build `built in 4.30s`.
- Combined source: full `manage.py test` with live keys blanked → `Ran 284 tests in 14.014s / OK (skipped=4)`; `npm test` → `tests 181 / pass 181 / fail 0`, then `tests 25 / pass 25 / fail 0`; `npm run build` → `built in 4.28s`. Logs: `.scratch/cg-boundaries-release/merged-*.log`. No dependency changes were needed.
- Runtime: existing Vite PID 87771 serves port 5173 from this checkout; Django reloaded as PID 36128 on port 8000 from the same checkout. Served scene metadata exactly matches the v2 manifest and all 21 rectangles. Source, served and rebuilt GLB SHA-256 match the original hash above.
- Actual `http://127.0.0.1:5173/rooms` → Cg Arch navigation displayed the new L-shaped floor plan and accepted a chair at (600,490). That browser guest lost its identity on reload; do not count that attempt as persistence proof. Three consecutive HTTP requests with a fresh private cookie jar retained their identity on that exact host. No authentication code or competing server was changed.
- Browser replay on the same running app at `http://localhost:5173/rooms` passed: placed at (600,490), dragged to (500,490), rejected a drag into the cabinet at (500,650), reloaded, selected the chair and read X500/Z490 from the existing controls. Cart remained 1. This hostname isolates the replay from the unstable 127.0.0.1 guest. Both test-created chairs were removed without altering other layouts or cart items.
- Screenshots: `.scratch/cg-boundaries-release/live-floor-plan.png`, `live-localhost-dragged.png`, and `live-localhost-reloaded.png`. The first shows the boundary at the requested 127.0.0.1 route; the last two show the successful same-runtime furnishing replay.
- No app servers were started by this integration; the user's existing 5173/8000 stack remains running. No GitHub push, remote-main merge or Vercel deployment was performed. This record completes local delivery only; it does not claim the licensed room is publicly deployed.
