# Supported placement: implementation and verification

Implemented locally on `codex/supported-placement`, based on main `9adbf97`. This change preserves the existing PlayCanvas editor controls. It is not merged or deployed.

## What works

- Place a GLB on a reviewed tabletop, or in either opening of the reviewed cabinet. The middle shelf is at 51.5 cm, the lower shelf at 3 cm, and the table at 75 cm.
- Click an object through the cabinet opening. Picking tests the actual authored panel boxes, so an empty opening does not intercept the child. Visible panels still select the cabinet.
- Drag the child within its support, with local 5 cm snapping. Reject overhang, excess headroom, intersections with panels or other objects, and unsupported heights.
- Move/rotate the parent and derive every child's world pose from its attachment. Preserve attachments across saves, reloads and ordered undo/redo. Refuse parent deletion while it supports children.
- Expose current room/floor identity, scene revision, surface and compartment references through `get_scene_context`. The compiler accepts `on(surface)` and `inside(compartment)`; region masks, previews and `try_place` share the same validation. Unknown targets do not become floor placements.

## Scope

The two reviewed supports are `support-demo-table` and `support-demo-cabinet`. Their GLBs are authored in metres from `shared/placement-profiles.json`; both geometry bounds and SHA-256 are checked against the collision/picking profiles. Other GLBs can be children using their catalogue bounding box. Unknown supports remain solid bounding boxes. Automatic cavity extraction, closed-door interaction and a support attached to another support are not implemented. All objects remain upright, with yaw rotation only. Fixed room obstacles retain the current conservative footprint checks.

Four demo models appear in the existing Tables rail because the current product contract has sofa/table/chair kinds. They are clearly named demo fixtures. No new editor panel or control was added.

## Reproduce through the current UI

From this worktree run:

```bash
BACKEND_PORT=8257 FRONTEND_PORT=5257 ./run-local.sh
```

Use `http://localhost:5257/room/empty-room`. Avoid mixing 127.0.0.1 sessions with other local worktrees: cookies are shared across ports. Use a separate browser session for a clean layout.

The verified Chrome window was 1226 by 769 pixels. Coordinates below are screenshot pixels; at another size click the named visible geometry instead.

1. Close search. Choose **Tables → Demo open cabinet**. Click the floor at approximately `(610,590)` in the reset camera. It saves at X300/Z115 cm. Press Escape after placement, then **Reset view**.
2. Choose **Tables → Demo storage box**. Click the visible middle horizontal shelf near `(580,510)`, inside the opening. It saves at X280/Z120/Y51.5 cm with target `upper` (label **Middle shelf**).
3. Press Escape, reset the view, and click the orange box at `(577,491)`. The properties heading must read **Demo storage box**, with X280/Z120. The cabinet must not capture that click.
4. Drag the box right to approximately `(632,491)`. X becomes310 and Y stays51.5. Drag beyond the cabinet edge: it returns to its last accepted pose with “The whole object must fit on its support”. Undo restores X280; Redo restores X310.
5. Click a visible side panel to select **Demo open cabinet**. Drag/rotate it: the box must preserve its local attachment. Verified cabinet X70→130 with child X45→105; rotating 90° changed child to X130/Z75 while Y remained51.5. Undo restored the previous rotation. These later poses reflect additional interaction in the same test session.
6. Place **Demo support table** on clear floor, then **Demo table lamp** on its visible top. Verified table X380/Z115 and lamp X380/Z120/Y75. Reload/reopen the room and click the lamp: its own properties remain selectable.

Screenshots and numeric scene evidence are in `.scratch/supported-placement/`: `middle-box-selected.png`, `middle-box-dragged.png`, `parent-moved-with-child.png`, `lamp-selected-after-reload.png`, `runtime-layout.json`, and `agent-context.json`. Scratch evidence is intentionally ignored by Git.

## Skyscraper replay

Computer Use also replayed insertion, selection and dragging in Safari at `http://localhost:5257/room/london-skyscraper?floor=C13` (displayed Floor 15/34). This loaded the complete existing building using its current floor transform. Cabinet pose was X2010/Z2035; the box was inserted into `upper` at X1990/Z2045/Y51.5, selected through the visible opening, and dragged to X2025 while Z2045/Y51.5 stayed fixed. API revision advanced 2→3. Switching C13→C14 removed this floor’s furniture; returning to C13 restored the cabinet and attached box at the saved pose. Screenshots: `skyscraper-middle-box-selected.png` and `skyscraper-middle-box-dragged.png`; authoritative snapshot: `skyscraper-layout.json`.

## Tests and runtime identity

- Backend: `.venv/bin/python manage.py test --noinput` → `Ran 292 tests in 13.057s` / `OK (skipped=5)`.
- Frontend: `npm test` → `tests 188 / pass 188 / fail 0`, then `tests 25 / pass 25 / fail 0`.
- Build: `npm run build` → `built in 3.47s` (existing large-chunk warning).
- New checks cover shelf layers, full-footprint support, rotated selection through the opening, parent transforms, stale references, atomic rejection, real GLB panel geometry, callback forwarding, attachment history, agent dry-run/idempotent retry and stable guest/claimed shopping identity after session rotation.
- The canonical stack used 8257/5257. Process working directories resolved to this worktree's backend and frontend. Source and built cabinet GLB SHA-256 both equal `2f56ba2acc79024ba9536d6e962bba61988bc53a9790056aad2194c921a38cb6`.

The UI test caught a missing attachment argument in `PlayCanvasScene.tsx`; this was fixed and the insertion was replayed successfully. A second integration issue used Django's rotating session key for compiler references; the compiler now uses the same stable shopping identity as scene reads while retaining the existing public throttle/CSRF behavior.

The temporary test stack was stopped after verification; ports 8257/5257 had no listener. Board checks: `6 passed, 0 failed`. Concurrent PC-workspace additions are separate work and are not included in these verification claims.

## Remaining verification

Live natural-language extraction is not claimed: no OpenAI key is configured in the inspected local checkouts. Compiler response/context tests use a model stub; real target validation, region solving and placement are tested independently. Replay “a lamp on the table” and “a box inside the cabinet middle shelf” with a configured provider before declaring the live AI workflow verified.
