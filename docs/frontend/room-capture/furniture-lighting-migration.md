# Furniture lighting migration

## Integration base and scope

`codex/room-furniture-lighting` starts at main `9adbf97` and locally merges completed stacking commit `76fd9ae` in `18e9a7e`. Stacking is a dependency, not a second support detector. The older `c12abd1` prototype was ported selectively; its floor-only finish origin is not retained.

The editor UI, room GLB/textures, catalogue, cart, saved-scene format, navigation and placement rules are retained. This uses PlayCanvas 2.22.2's existing PBR shaders. It does not reconstruct room lights, ray trace, or generate new high-resolution textures.

## Rendering paths

- `furnitureLightingProfile.ts`: authored profiles for London, empty, CGArch and Haussmann. London is identified by its reviewed source hash. Unknown assets keep a neutral fallback. Profiles are visual estimates, not measured light probes.
- `furnitureAppearance.ts`: one furniture layer, two directional lights, and at most one 64×64 contact texture per room. Furniture-only shadows exclude baked architecture as a caster/receiver. The empty fixture shares its existing lights and its lit floor receives actual geometry shadows. Its enclosing mesh is excluded as a caster so the ceiling does not black out the indoor key.
- The furniture key has one 1024 shadow map with a 6 m range. A vase casts a real shadow on its lit table. Baked/emissive floors and splats cannot receive this shadow; a restrained transparent footprint supplies approximate floor contact there. A 0.8 cm depth offset clears prepared floor sampling tolerance. Raised items hide this approximation and use real support shadows.
- `furnitureFinish.ts`: clones lit materials per model, preserving color, normal, metalness/roughness, emission, transmission and alpha. Furniture-only ambient uses the pinned engine's `ambientSH` property (missing from its generated declarations). Existing source probes take precedence. Glass skips the diffuse finish and opaque shadow casting. Unlit materials stay unlit. Anisotropy is capped at 8.
- The optional finish attenuates diffuse light by at most 4% near the object base. It preserves specular, reflection and emission and includes the support height in its origin. It is not the room-lighting mechanism.
- London's existing licensed HDR still supplies reflections. Its glass correction, tone mapping and architectural lighting remain. Other rooms keep their exposure/tonemapping. CGArch light/ambient values are authored under its existing +2.96 EV / ACES2 output. An automatic inverse-exposure trial was rejected visually because it crushed the furniture midtones. No approximate environment atlas is invented.

Shadow maps are reused until an item changes, an animation runs, the camera moves 15 cm or turns 3 degrees, or the capture target/projection changes. Captures force a fresh map. No shadow texture is allocated per object.

The completed stacking dependency rendered raised objects but kept selection bounds and selection footprints at floor height. This integration corrects both using the same derived height, with an off-centre inside/outside hit regression; placement validation is unchanged.

`FurnitureVisual.setPose` updates model, shader origin and contact visibility together. Live movement, previews and frozen photographic models use that path with `supportHeightCm`. Source resources stay cached; visual disposal frees owned material clones. Room disposal frees lights, layer, contact material/texture; the existing environment owner frees its HDR-derived resources.

## Reproduce checks

Run `DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,rendering.localhost BACKEND_PORT=8247 FRONTEND_PORT=5247 ./run-local.sh` from the repository root and open `http://rendering.localhost:5247`. The separate hostname avoids guest-cookie clashes with teammates' localhost servers (cookies are not isolated by port). Normal user path: `/rooms` → `/room/empty-room` or `/room/london-skyscraper?floor=C01`.

Development-only fixture: `/dev/rendering-check.html?room=london-skyscraper-test&lighting=room`. This HTML is not a production build entry. It uses the production runtime, furniture layer, stacking and photographic capture with the grey sofa, LISABO table and a small off-centre Stone & Beam vase. `lighting=legacy` keeps identical geometry/camera with old furniture illumination. Links cover empty, London, CGArch and Haussmann.

Use Table detail, Move and rotate vase, Photographic capture and 30 second walkthrough. Timing reports raw frame-end intervals after 3 s warm-up; these are browser measurements on a shared workstation, not isolated GPU timings. Evidence is under ignored `.scratch/rendering/`.

## Verification and release status

- Fresh main: `manage.py test` → `Ran 281 tests in 16.787s / OK (skipped=5)`; `npm test` → `181 + 25 passed`; build `6.21s`.
- Integrated stacking baseline: `manage.py test` → `Ran 284 tests in 15.195s / OK (skipped=5)`; `npm test` → `184 + 25 passed`; build `5.15s`.
- Final rendering checks: `OPENAI_API_KEY= DEEPGRAM_API_KEY= ELASTIC_URL= ELASTIC_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test` → `Ran 284 tests in 18.841s / OK (skipped=4)`; `npm test` → `tests 192 / pass 192 / fail 0` and `tests 25 / pass 25 / fail 0`; `npm run build` → `built in 5.30s`. The extra asset reduced the optional skips; the backend test count did not drop. Existing large-bundle warnings remain.
- Matched before/after screenshots and production photographic captures cover empty, London, CGArch and Haussmann. The London table detail confirms a geometry shadow from the 10.8 cm vase at 74 cm support height; moving/rotating the vase updates that shadow. London glass and source textures remain visible.
- Chrome normal editor: selected the raised vase, dragged (445,290) to (425,280), rotated 90 degrees, undid rotation, reloaded, visited London, moved from lobby Floor 1/34 to mezzanine Floor 2/34, and returned. Persisted scene revision 4 still contains the vase at (425,280), yaw 0. The normal UI and cart count are unchanged. Browser graphics warning/error log was empty after these checks.
- Fresh `frontend/dist` was served with `npm run preview -- --host 127.0.0.1 --port 5248 --strictPort` and opened at `http://rendering.localhost:5248/room/empty-room`. The saved furniture and shadows render there. HTTP bytes match the fresh renderer bundle `PlayCanvasScene-C6JgMZhl.js`, SHA-256 `b270f8630cda131a419965f184f573cb4b04faeb38af60ad40a7b68b655edf3a`. This proves the local production artifact, not a hosted deployment.
- Local assets: original London/empty, CGArch 68,229,960-byte GLB and Haussmann SOG/collision pair. Studio 11 and CGArch lightmapper proof binaries are absent; those paths are not visually accepted.
- CGArch's existing mottled trim/lightmap artifacts and original model texture resolution remain. Lighting cannot recover absent source detail.
- Cleanup verified: no listeners remain on 8247, 5247 or 5248; temporary browser tabs were closed. Other stacks remain untouched.
- This task has not pushed, merged main or refreshed Vercel. Hosted acceptance remains open; local checks do not prove a refreshed release.

## Frame pacing

One 30 second London walkthrough, three placed GLBs, first three seconds excluded:

| Variant | Frames sampled | Median | p95 | Frames over 50 ms |
| --- | ---: | ---: | ---: | ---: |
| Original furniture lighting | 1721 | 12.0 ms | 30.6 ms | 5 |
| Rejected 2048 shadow every frame | 859 | 26.2 ms | 51.6 ms | 59 |
| Accepted 1024 cached shadow | 1361 | 19.9 ms | 25.0 ms | 1 |

The accepted effect has a higher median cost than the baseline. It improves this run's tail pacing but does not establish 60 fps, GPU-isolated performance, or a large-catalogue stress result. No Haussmann performance result is claimed.

## Migrate into the current integration branch

1. Let overlapping furniture/capture work settle and run the required fresh-main baseline at a task boundary. This branch was tested against `9adbf97` plus stacking `76fd9ae`; it is not evidence that a later main is compatible.
2. Integrate the completed stacking contract first if it is absent. The local merge `18e9a7e` records that dependency. Do not replay the old `c12abd1` experiment. If the newer branch has richer support surfaces, preserve its height solver and adapt these visual calls to its result.
3. Apply this branch's rendering commit after the dependency. Review overlaps in `furniture.ts`, `runtime.ts`, `interaction.ts`, `overlays.ts` and the test import list. Keep the newer agent harness, movement and capture contracts. Reconcile current TODO/board records rather than replacing teammates' records.
4. No database migration, new dependency, API credential or saved-scene-format change is required by the rendering commit. Provision the existing licensed assets using the room preparation docs; this change does not publish or change their binaries.
5. Run the full backend suite, both groups in `npm test`, and `npm run build`; then repeat the ordinary editor and photographic checks on the integrated artifact. Any later hosted release must verify its actual served bundle and the same saved-scene workflow.

Evidence files live in ignored `.scratch/rendering/`: `before-*.png`, `after-*.png`, `capture-{empty,london,cgarch,haussmann}.png`, `vase-before-move.png`, `vase-after-move.png`, `editor-vase-after-undo.png`, `editor-london-{lobby,mezzanine}.png`, `production-build-empty-room.png`, walkthrough JSON and `final-*.log`. These are local evidence, not source assets.

## References

- [PlayCanvas PBR](https://developer.playcanvas.com/user-manual/graphics/physical-rendering/)
- [Dynamic lighting and baked lightmaps](https://developer.playcanvas.com/user-manual/graphics/lighting/)
- [StandardMaterial](https://api.playcanvas.com/engine/classes/StandardMaterial.html)
- [Stacking contract](../3d-object/furniture-stacking.md)
