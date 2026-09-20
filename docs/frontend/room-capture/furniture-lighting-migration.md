# Furniture lighting migration

## Integration base and scope

PR #102 integrates with current main `5afe392`, including its scene designer and reviewed surface/compartment attachment contract. The renderer consumes `pose.yCm` after main's attachment resolver; it never infers support from bounding-box overlap. The branch's initial `76fd9ae` stacking dependency was superseded during integration, including its obsolete probe, agreement test, documentation and temporary CI setup. Current main's backend, support tests, interaction, catalogue and capture paths are preserved. The older `c12abd1` lighting prototype was ported selectively; its floor-only shader origin is not retained.

The editor UI, room GLB/textures, catalogue, cart, saved-scene format, navigation and placement rules are retained. This uses PlayCanvas 2.22.2's existing PBR shaders. It does not reconstruct room lights, ray trace, or generate new high-resolution textures.

## Rendering paths

- `furnitureLightingProfile.ts`: authored profiles for London, empty, CGArch and Haussmann. London is identified by its reviewed source hash. Unknown assets keep a neutral fallback. Profiles are visual estimates, not measured light probes.
- `furnitureAppearance.ts`: one furniture layer, two directional lights, and at most one 64×64 contact texture per room. Furniture-only shadows exclude baked architecture as a caster/receiver. The empty fixture shares its existing lights and its lit floor receives actual geometry shadows. Its enclosing mesh is excluded as a caster so the ceiling does not black out the indoor key.
- The furniture key has one 1024 shadow map with a 6 m range. A vase casts a real shadow on its lit table. Baked/emissive floors and splats cannot receive this shadow; a restrained transparent footprint supplies approximate floor contact there. A 0.8 cm depth offset clears prepared floor sampling tolerance. Raised items hide this approximation and use real support shadows.
- `furnitureFinish.ts`: clones lit materials per model, preserving color, normal, metalness/roughness, emission, transmission and alpha. Furniture-only ambient uses the pinned engine's `ambientSH` property (missing from its generated declarations). Existing source probes take precedence. Glass skips the diffuse finish and opaque shadow casting. Unlit materials stay unlit. Anisotropy is capped at 8.
- The optional finish attenuates diffuse light by at most 4% near the object base. It preserves specular, reflection and emission and includes the support height in its origin. It is not the room-lighting mechanism.
- London's existing licensed HDR still supplies reflections. Its glass correction, tone mapping and architectural lighting remain. Other rooms keep their exposure/tonemapping. CGArch light/ambient values are authored under its existing +2.96 EV / ACES2 output. An automatic inverse-exposure trial was rejected visually because it crushed the furniture midtones. No approximate environment atlas is invented.

Shadow maps are reused until an item changes, an animation runs, the camera moves 15 cm or turns 3 degrees, or the capture target/projection changes. Captures force a fresh map. No shadow texture is allocated per object.

Current main already selects raised items through authored cabinet openings and moves attached children with their parent. Those paths are retained. The only overlay adjustment suppresses the floor grid for an elevated preview; its existing raised footprint remains visible.

`FurnitureVisual.setPose` updates model, shader origin and contact visibility together. Live movement, previews and frozen photographic models use that path with resolved `pose.yCm`. Source resources stay cached; visual disposal frees owned material clones. Room disposal frees lights, layer, contact material/texture; the existing environment owner frees its HDR-derived resources.

## Reproduce checks

Run `DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,rendering.localhost BACKEND_PORT=8247 FRONTEND_PORT=5247 ./run-local.sh` from the repository root and open `http://rendering.localhost:5247`. The separate hostname avoids guest-cookie clashes with teammates' localhost servers (cookies are not isolated by port). Normal user path: `/rooms` → `/room/empty-room` or `/room/london-skyscraper?floor=C01`.

Development-only fixture: `/dev/rendering-check.html?room=london-skyscraper-test&lighting=room`. This HTML is not a production build entry. It uses the production runtime, furniture layer, reviewed attachments and photographic capture with the grey sofa, 75 cm demo support table and a small off-centre Stone & Beam vase. `lighting=legacy` keeps identical geometry/camera with old furniture illumination. Links cover empty, London, CGArch and Haussmann.

Use Table detail, Move and rotate vase, Photographic capture and 30 second walkthrough. Timing reports raw frame-end intervals after 3 s warm-up; these are browser measurements on a shared workstation, not isolated GPU timings. Evidence is under ignored `.scratch/rendering/`.

## Historical verification before the newer support integration

The results below were measured on the earlier branch with the 74 cm LISABO table. They establish rendering behavior and cost on that revision; current attachment integration has separate acceptance below.

- Fresh main: `manage.py test` → `Ran 281 tests in 16.787s / OK (skipped=5)`; `npm test` → `181 + 25 passed`; build `6.21s`.
- Integrated stacking baseline: `manage.py test` → `Ran 284 tests in 15.195s / OK (skipped=5)`; `npm test` → `184 + 25 passed`; build `5.15s`.
- Final rendering checks: `OPENAI_API_KEY= DEEPGRAM_API_KEY= ELASTIC_URL= ELASTIC_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test` → `Ran 284 tests in 18.841s / OK (skipped=4)`; `npm test` → `tests 192 / pass 192 / fail 0` and `tests 25 / pass 25 / fail 0`; `npm run build` → `built in 5.30s`. The extra asset reduced the optional skips; the backend test count did not drop. Existing large-bundle warnings remain.
- Matched before/after screenshots and production photographic captures cover empty, London, CGArch and Haussmann. The London table detail confirms a geometry shadow from the 10.8 cm vase at 74 cm support height; moving/rotating the vase updates that shadow. London glass and source textures remain visible.
- Chrome normal editor: selected the raised vase, dragged (445,290) to (425,280), rotated 90 degrees, undid rotation, reloaded, visited London, moved from lobby Floor 1/34 to mezzanine Floor 2/34, and returned. Persisted scene revision 4 still contains the vase at (425,280), yaw 0. The normal UI and cart count are unchanged. Browser graphics warning/error log was empty after these checks.
- Fresh `frontend/dist` was served with `npm run preview -- --host 127.0.0.1 --port 5248 --strictPort` and opened at `http://rendering.localhost:5248/room/empty-room`. The saved furniture and shadows render there. HTTP bytes match the fresh renderer bundle `PlayCanvasScene-C6JgMZhl.js`, SHA-256 `b270f8630cda131a419965f184f573cb4b04faeb38af60ad40a7b68b655edf3a`. This proves the local production artifact, not a hosted deployment.
- Local assets: original London/empty, CGArch 68,229,960-byte GLB and Haussmann SOG/collision pair. Studio 11 and CGArch lightmapper proof binaries are absent; those paths are not visually accepted.
- CGArch's existing mottled trim/lightmap artifacts and original model texture resolution remain. Lighting cannot recover absent source detail.
- Cleanup verified: no listeners remain on 8247, 5247 or 5248; temporary browser tabs were closed. Other stacks remain untouched.


## Frame pacing

One 30 second London walkthrough, three placed GLBs, first three seconds excluded:

| Variant | Frames sampled | Median | p95 | Frames over 50 ms |
| --- | ---: | ---: | ---: | ---: |
| Original furniture lighting | 1721 | 12.0 ms | 30.6 ms | 5 |
| Rejected 2048 shadow every frame | 859 | 26.2 ms | 51.6 ms | 59 |
| Accepted 1024 cached shadow | 1361 | 19.9 ms | 25.0 ms | 1 |

The accepted effect has a higher median cost than the baseline. It improves this run's tail pacing but does not establish 60 fps, GPU-isolated performance, or a large-catalogue stress result. No Haussmann performance result is claimed.

## Current main integration and acceptance

The user authorized merging PR #102. Current main `5afe392` baseline passed `manage.py test`: `Ran 390 tests in 17.735s / OK (skipped=4)`; `npm test`: `195+25` passed; build `3.99s`. The integration preserves that release's explicit supports and scene designer. The renderer adds no database migration, provider credential, catalogue model or saved-scene format change.

Current regression resolves actual reviewed attachments at table 75 cm and cabinet middle shelf 51.5 cm, translates/rotates the parent, then detaches the child. Both entity position and shader origin must agree after every transition. The development fixture has been migrated to that same contract. Integrated checks: `manage.py test` → `Ran 390 tests in 17.884s / OK (skipped=4)`; `npm test` → `202/202` plus `25/25`, zero failures; `npm run build` → `built in 5.87s`. Chrome selected the middle-shelf box through the opening, dragged X250→270, undid, moved the cabinet X270→320 and rotated it 90 degrees. Server revision 9 confirms child (322,135,Y51.5) with unchanged local attachment. Undo and reload preserved its shelf contact. The London fixture renders the 75 cm tabletop vase and real shadow; move/rotation and frozen photographic capture preserve the same contact. Evidence: `.scratch/rendering/integrated-{london-table,london-capture,cabinet-child-drag,parent-rotation,editor-reloaded}.png`. Main's designer, support, catalogue, API, capture and navigation source remains unchanged by the rendering delta. Vercel has not been refreshed by this rendering task; a hosted release must verify its served bundle and saved-scene workflow independently.

Evidence files live in ignored `.scratch/rendering/`: `before-*.png`, `after-*.png`, `capture-{empty,london,cgarch,haussmann}.png`, `vase-before-move.png`, `vase-after-move.png`, `editor-vase-after-undo.png`, `editor-london-{lobby,mezzanine}.png`, `production-build-empty-room.png`, walkthrough JSON and `final-*.log`. These are local evidence, not source assets.

## References

- [PlayCanvas PBR](https://developer.playcanvas.com/user-manual/graphics/physical-rendering/)
- [Dynamic lighting and baked lightmaps](https://developer.playcanvas.com/user-manual/graphics/lighting/)
- [StandardMaterial](https://api.playcanvas.com/engine/classes/StandardMaterial.html)
- [Reviewed support contract and UI verification](../3d-object/supported-placement-verification.md)
