# Adelle — tasks and agent work log

Record all agent work here when working for Adelle. Include status, file paths, verification, and blockers or handoff notes.

## Shared room test download

- Use [HAUSSMANN APARTMENT](https://superspl.at/scene/4de797f4) as the shared Gaussian room test download. SuperSplat login may be required. Credit Stéphane Agullo (sa3d), CC BY 4.0; retain the downloaded license. This is an authored test scene with assumed scale, not a measured room.

## In progress

- None.

## Next

- Confirm scope and ownership with the team.

## Done

- None yet.

## Blockers / handoff

- None recorded.

## Note from Saketh's lane — a colour call for you (2026-09-19)

Appended by Saketh's agent; nothing above was changed. The floor region that lights up when a catalogue item is hovered is a system green (`#29a05c` to `#59f28c`). Against the cream-and-terracotta shell it reads as system UI rather than part of the room. It is low priority and was left alone on purpose, since the palette is yours. The two colours are in the fragment shader in `frontend/src/region/FloorOverlay.tsx` (`vec3(0.16, 0.62, 0.36)` and `vec3(0.35, 0.95, 0.55)`); the catalogue panel's styles are in `frontend/src/catalogue/shelf.css` and use the shell's existing tokens.

## Note from Saketh's lane — HERRÅKRA chair verdict (2026-09-20)

Appended by Saketh's agent; nothing above was changed. Full comment is on your commit `eb7b3ec`. Measured from `model.glb` directly: up axis +Y ✅, front +Z ✅ (backrest at mean z −0.36), 3.66 MB ✅, 29,827 triangles ✅. **Fails on scale and pivot:** the box is 1.824 × 1.899 × 1.753 m centred on the origin (Meshy normalises to a ±0.95 cube), so it would render 2.6× too big and half below the floor. Fix: scale uniformly by **0.3845**, lift **+0.3654 m**, apply transforms, re-export; or reply "go" on the commit and I will set that transform on the GLB's root node, which is lossless. After it the box is 70.1 × 73.0 × 67.4 cm against IKEA's 71 × 73 × 66.

## Note from Saketh's lane — `AGENTS.md`: after every merge, run the suite on fresh `main` (2026-09-20)

Appended by Saketh's agent; nothing above was changed. It binds all four agents. New section **Trust the remote, not your terminal**:

- After a push: never pipe a git command whose exit code matters; check `git rev-parse HEAD` equals `git rev-parse origin/<branch>`; a behavioural claim in a PR description needs a test behind it.
- After every merge: `git checkout main`, `git pull`, delete the merged branch locally, **run the full suite and the frontend build on that fresh `main`**, then branch fresh. Merging updates GitHub, not your clone. A PR is tested against the `main` it was cut from, not the one it lands in, so two green PRs can take `main` down together with no conflict; it has happened here once already. Whoever merges runs the suite at once, and a red `main` is a whole-team stop, announced before anything else.
