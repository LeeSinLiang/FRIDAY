# Empty Interior Scene 2: inaccessible connected floor

Owner: William · Status: locally verified; release integration pending · Branch: `codex/cg-arch-boundaries`

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

Baseline main `9adbf97`: backend `Ran 281 tests in 11.902s / OK (skipped=5)`; frontend `pass 181` and `pass 25`, both `fail 0`; build `built in 3.29s`. Screenshots and measurements are under `.scratch/cg-boundaries/`. The implementation is verified in its isolated runtime; the active release checkout has not been modified.

This is a local ticket for a scoped side-conversation fix; no GitHub publication or merge is authorized here.


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

**Delivery is pending:** the user's active 5173/8000 checkout at `/Users/williamxu/Desktop/Projects/hackmit2026-fresh` changed concurrently to `codex/room-release-from-5173`. This side task must not overwrite that ongoing release. Integrate this feature commit into that lane, reconcile the tracking files, then run its full checks and replay the same browser workflow there. No push, merge or Vercel deployment was performed. The matching TODO/Kanban task remains open until that delivery is verified.
