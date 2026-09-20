# Adelle — tasks and agent work log

Record all agent work here when working for Adelle. Include status, file paths, verification, and blockers or handoff notes.

## In progress

- None.

## Next

- Priority per `docs/frontend/3d-object/collaborator-handoff.md`: deliver sofa + table assets (chair was pushed first as a pipeline smoke test — see below).
- Open in Blender to verify/fix pivot, axes, and add PBR maps for the chair asset before treating it as catalogue-ready.

## Done

- Pushed `shared/models/furniture/herrakra-armchair-diseroed-dark-yellow/` (model.glb, thumbnail.png, metadata.json) on branch `codex/adelle-herrakra-chair-asset`. Generated via Higgsfield `image_to_3d` (Meshy) from a single 160x160px IKEA product thumbnail, `should_texture=true`, no PBR. Dimensions (71x66x73 cm) verified against IKEA's official US product page (converted from inches), not measured directly. Full details and known limitations in `docs/frontend/3d-object/herrakra-chair-asset-notes.md`.
- Verification run: `cd frontend && npm ci` on fresh `main` succeeded (91 packages, 0 vulnerabilities). Did **not** run `./setup.sh` or the backend test suite — it installs `uv` via a piped curl script, which this session's tooling blocked as an external-code execution risk. No backend/Django code was touched by this change, so the frontend-only check was judged sufficient; flagging so a teammate can run the full suite if needed.

## Blockers / handoff

- Chair asset delivered out of the agreed build order (spec asks for sofa + table first). Sofa/table generation not yet done.
- Chair asset has known gaps vs. the collaborator-handoff spec (no PBR, unverified pivot/axes, low-res source image) — see notes doc. Not yet acceptance-checked in the actual room editor.
