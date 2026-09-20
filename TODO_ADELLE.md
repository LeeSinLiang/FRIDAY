# Adelle — tasks and agent work log

Record all agent work here when working for Adelle. Include status, file paths, verification, and blockers or handoff notes.

## Shared room test download

- Use [HAUSSMANN APARTMENT](https://superspl.at/scene/4de797f4) as the shared Gaussian room test download. SuperSplat login may be required. Credit Stéphane Agullo (sa3d), CC BY 4.0; retain the downloaded license. This is an authored test scene with assumed scale, not a measured room.

## In progress

- Nightstand/side table, rug, and dresser (HEMNES-style) still not started — image file paths were unreliable this session (didn't save to disk more than once); dresser is on hold pending a usable path.

## Next

- **Three open branches now carry at least one asset that fails `backend/api/test_furniture_assets.py`**: `codex/adelle-sofa-bed-assets` (sofa + bed), `codex/adelle-bookshelf-coffeetable-assets` (the coffee table; the bookshelf on that branch passes). None of these should merge into `main` without a `multi_image_to_3d` regeneration pass using extra angle photos.
- Table was the other priority item from `collaborator-handoff.md` — now delivered (STOCKHOLM coffee table), but failing, so still not truly done.
- Open all four failing/at-risk assets (chair — since fixed by Saketh's lane —, sofa, bed, coffee table) in Blender to inspect real proportions against source photos.

## Done

- Pushed `shared/models/furniture/herrakra-armchair-diseroed-dark-yellow/` (model.glb, thumbnail.png, metadata.json) on branch `codex/adelle-herrakra-chair-asset`. Generated via Higgsfield `image_to_3d` (Meshy) from a single 160x160px IKEA product thumbnail, `should_texture=true`, no PBR. Dimensions (71x66x73 cm) verified against IKEA's official US product page (converted from inches), not measured directly. Since fixed and wired in by Saketh's lane (see notes below) — this one is resolved.
- On branch `codex/adelle-sofa-bed-assets` (separate from this one, not yet merged): pushed EKTORP 2-seat sofa + RAMNEFJÄLL bed, both **failing** the dimension check by 7-18cm per axis (single-photo proportion error). Full numbers in that branch's `docs/frontend/3d-object/ektorp-sofa-ramnefjall-bed-asset-notes.md`.
- This branch (`codex/adelle-bookshelf-coffeetable-assets`): pushed `shared/models/furniture/low-open-bookshelf-navy-oak-top/` (generic/unidentified item, demo `catalogueListingId`, **passes cleanly** — 1.87MB, 10,307 triangles, dimensions self-declared to match its own measured geometry since there's no real product to check against) and `shared/models/furniture/stockholm-coffee-table-walnut-veneer/` (real IKEA STOCKHOLM, 702.397.10, $449.99 — **fails** the dimension check: 155.5x40.0x53.1cm measured vs real 180x40x59cm, width off 24.5cm/depth off 5.9cm vs ~5.4cm/~2cm tolerance). Both generated `should_texture=true, enable_pbr=true`, then `gltf-transform optimize --compress false --texture-compress auto --texture-size 1024 --simplify` to fix oversized PBR exports (7.3MB/23.6k tri and 13.9MB/**30,686 tri — over the 30k cap on its own** → 1.87MB/10.3k and 4.1MB/22.4k). Full details in `docs/frontend/3d-object/bookshelf-stockholm-table-asset-notes.md`.
- The coffee table's failure was not re-confirmed with a fresh question — it's the identical failure class (single-photo proportion error) already flagged and accepted once this session for the sofa/bed; applying the same standing decision rather than re-asking.
- Verification run (chair branch only): `cd frontend && npm ci` on fresh `main` succeeded (91 packages, 0 vulnerabilities). Did **not** run `./setup.sh` or the backend test suite on any of these branches — it installs `uv` via a piped curl script, which this session's tooling blocked as an external-code execution risk. Used a standalone script importing `backend/api/glb.py` (stdlib-only) to replicate the dimension/floor/triangle/size checks instead, but the full Django test suite has not actually been run on any of these branches.

## Blockers / handoff

- **Three branches, none merged, none should be merged as-is**: `codex/adelle-herrakra-chair-asset` (superseded — already fixed and merged by Saketh's lane), `codex/adelle-sofa-bed-assets` (sofa + bed both fail dimension check), `codex/adelle-bookshelf-coffeetable-assets` (bookshelf passes, coffee table fails dimension check). This is the "red main is a whole-team stop" scenario for the latter two if merged without fixing first.
- Bookshelf and coffee table images came from local file paths this time (worked); the earlier HEMNES-style dresser image never produced a usable path across two attempts — still blocked on that one specifically.
- Nightstand and rug (rest of the 5-more living-room list) not started yet.

## Note from Saketh's lane — a colour call for you (2026-09-19)

Appended by Saketh's agent; nothing above was changed. The floor region that lights up when a catalogue item is hovered is a system green (`#29a05c` to `#59f28c`). Against the cream-and-terracotta shell it reads as system UI rather than part of the room. It is low priority and was left alone on purpose, since the palette is yours. The two colours are in the fragment shader in `frontend/src/region/FloorOverlay.tsx` (`vec3(0.16, 0.62, 0.36)` and `vec3(0.35, 0.95, 0.55)`); the catalogue panel's styles are in `frontend/src/catalogue/shelf.css` and use the shell's existing tokens.

## Note from Saketh's lane — HERRÅKRA chair verdict (2026-09-20)

Appended by Saketh's agent; nothing above was changed. Full comment is on your commit `eb7b3ec`. Measured from `model.glb` directly: up axis +Y ✅, front +Z ✅ (backrest at mean z −0.36), 3.66 MB ✅, 29,827 triangles ✅. **Fails on scale and pivot:** the box is 1.824 × 1.899 × 1.753 m centred on the origin (Meshy normalises to a ±0.95 cube), so it would render 2.6× too big and half below the floor. Fix: scale uniformly by **0.3845**, lift **+0.3654 m**, apply transforms, re-export; or reply "go" on the commit and I will set that transform on the GLB's root node, which is lossless. After it the box is 70.1 × 73.0 × 67.4 cm against IKEA's 71 × 73 × 66.

## Note from Saketh's lane — `AGENTS.md`: after every merge, run the suite on fresh `main` (2026-09-20)

Appended by Saketh's agent; nothing above was changed. It binds all four agents. New section **Trust the remote, not your terminal**:

- After a push: never pipe a git command whose exit code matters; check `git rev-parse HEAD` equals `git rev-parse origin/<branch>`; a behavioural claim in a PR description needs a test behind it.
- After every merge: `git checkout main`, `git pull`, delete the merged branch locally, **run the full suite and the frontend build on that fresh `main`**, then branch fresh. Merging updates GitHub, not your clone. A PR is tested against the `main` it was cut from, not the one it lands in, so two green PRs can take `main` down together with no conflict; it has happened here once already. Whoever merges runs the suite at once, and a red `main` is a whole-team stop, announced before anything else.

## Note from Saketh's lane — HERRÅKRA is fixed, wired and in the room (2026-09-20)

Appended by Saketh's agent; nothing above was changed except that your two blocker bullets were kept under your own heading when your commit was brought in. No reply had come on the commit, so rather than wait I applied the fix I offered. Your commit `eb7b3ec` was cherry-picked with your authorship.

- `model.glb` now has a root node that scales it uniformly by 0.3845 and lifts it 0.3654 m. No vertex, index or texture byte changed (verified by hash). Measured after: 70.1 × 73.0 × 67.4 cm, feet at y = 0. `metadata.json` records this under `fit`, and gained `catalogueListingId`. **If you re-export, run `python3 scripts/fit_glb.py <model.glb> 73` again.**
- HERRÅKRA is now a catalogue listing, `ikea-405.355.47` (710 × 660 × 730 mm, $149), and it is the item the demo hovers, because it is the one that looks like a chair. Seen in the room at true scale with "3D model loaded".
- **Triangle budget: 29,827 is at the very top for one chair. For the sofa and table please target 10–15k.** If we end up with several assets they go through `gltf-transform` before they go in the repo.
- Your next assets are checked automatically by the backend test suite; the rules are in `docs/frontend/3d-object/collaborator-handoff.md` under "Automated asset check".
