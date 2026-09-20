# Cg Arch interior fixture

The selected room is [Empty Interior Scene 2 by Cg Arch](https://www.blendkit.com/asset-gallery-detail/e58113ed-e234-4bc9-a75a-8a5bb3d5396e/), downloaded with the official Blendkit add-on in Blender 5.2.1. Search for `asset_base_id:e58113ed-e234-4bc9-a75a-8a5bb3d5396e asset_type:scene` and append the scene. The approximately 187 MiB source contains packed wall and laminate textures, cabinetry, adjoining rooms and Blender-specific lighting.

## Local preparation

Run from the repository root, substituting your downloaded source path:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec '/path/to/empty-interior-scene-2.blend' --python scripts/bake_cg_arch_room.py
```

The bake script evaluates and joins the fixed architectural meshes, preserves source texture UVs, and creates a separate lighting atlas. The V6 preparation bakes direct and indirect diffuse illumination without material color at 2048 × 2048, 32 samples, and four CPU threads. A separate OpenImageDenoise RT HDR pass filters only the linear illumination because Cycles image baking does not automatically apply render denoising. The bundled RTLightmap mode rejected this input. The script uses Blender's bundled macOS `libOpenImageDenoise.dylib`; a missing library or reported denoising error stops preparation. A raw EXR and prepared Blender checkpoint are saved in ignored asset storage before postprocessing, allowing retries without repeating ray tracing.

V6 retains the original material textures on UV0 and encodes linear irradiance separately as an RGBM atlas on UV1. The PlayCanvas importer recognizes explicit room-lightmap metadata, moves the occlusion-texture carrier to the lightmap slot, decodes RGBM, and suppresses duplicate dynamic/ambient illumination for these fixed surfaces. Exported color-management metadata preserves the source exposure of +2.961538 EV (7.78954×). Its ACES2 display mapping approximates the source AgX High Contrast transform. Glass uses a scene-color grab for runtime transmission; newly placed furniture retains independent runtime lighting. The roughly 60.4 MB export has seven embedded images and twelve lightmapped materials. Structure and decoding are verified; final appearance remains unaccepted while source material-node translation and trim artifacts are corrected.

V9 subsequently preserves authored Hue/Saturation operations that glTF skipped: wall saturation 0/value 2.6, and floor saturation 0.5/value 0.5. These transformations are applied to original textures in linear color; no extra ray bake was needed. The local export is 68,229,960 bytes with eight images. Wall color improved in browser checks, but narrow trim and cabinetry remain mottled. This is not an accepted match to the Blender reference; see the [open-source alternatives](rendering-alternatives.md#open-source-replacement-for-the-custom-baker).

The earlier V4 combined color-and-light atlas was a technically valid unlit UV0 GLB (14,210,704 bytes, 281,527 polygons, one 2048 atlas), but **failed visual acceptance** against the reference. It is not the final quality baseline. Blender reported cleanup exit 134 after the completed V4 export; the generated binary passed structural checks, which did not establish acceptable appearance.

The bake calls `scripts/prepare_cg_arch_room.py` to normalize the source origin, check the living-room floor region, and export `shared/rooms/cg-arch-interior/assets/room.glb`. Source `archicadobjects` and distant helper geometry are excluded by the exporter. The downloaded source remains untouched. Geometry stays in meters, with glTF Y-up; the manifest and placement API use centimeters. Source Blender origin is (-12.5187892914, 9.5932369232, 0): editor x is `(source x + 12.5187892914) * 100`, z is `(9.5932369232 - source y) * 100`.

The earlier raw export did not preserve the source lighting and is superseded by this bake pipeline. Final baked binary size, atlas quality, and browser appearance must be checked after a successful bake; do not infer success from an export log alone. Rerun preparation when the source changes. Changes to room dimensions or placement areas require geometry review.

## Runtime and placement

At Vite startup or build, the editor selects `cg-arch-interior` only when all its referenced runtime files exist. A clean checkout defaults to the tracked `empty-room` fixture. The build warns and omits an entire optional room package when files under its local `assets/` directory are missing. Missing manifests, licenses or spatial metadata, malformed references, symlinks and unsafe file types remain errors. The tracked empty-room package is required.

Provision Cg Arch through the licensed local preparation steps above, then restart Vite or rebuild to select it automatically. Explicit `?room=cg-arch-interior`, `?room=empty-room`, `?room=studio-11` and `?room=cg-arch-lightmapper-proof` selections remain explicit: an unavailable requested room reports a loading error rather than silently showing a different room. Each room has a separate saved layout. Attribution remains visible in the editor. The earlier room spotlight was removed to avoid relighting the baked architecture; splat lighting is unchanged.

The packaging regression checks run with `cd frontend && node --experimental-strip-types --test scripts/shared-room-assets.test.ts` on a Node version supporting TypeScript stripping. They cover clean-checkout fallback, complete local provisioning, missing metadata, unsafe references and dangling symlinks.

The v2 boundary review enables 36.730 m² of connected living room, corridor and entry. Runtime walking and placement share the same union of 21 conservative rectangles; the mini-map and plan use its outline. Closed glass doors, cabinetry and disconnected rooms remain excluded. The exact original GLB is checked by `uv run --with numpy --with shapely python scripts/prepare_cg_arch_boundaries.py`: complete 5 cm cells must have ground support and avoid geometry crossing 5–240 cm height, including thin barriers with a 1 cm margin. The original x=787..1121, z=180..760 cm rectangle is fully retained. This is authored fixture coverage, not a surveyed scan or dynamic collision system. See [boundary review and verification](../../tickets/cg-arch-boundaries.md).

The default camera is at (1100, 121, 735) cm, yaw 0.898638 rad, pitch -0.023463 rad, with a 57-degree vertical field of view. It follows the source camera direction and low architectural eye height while moving 26 cm inward for the 20 cm navigation clearance. Its framing still needs browser comparison after the lighting bake; matching a source camera direction does not guarantee matching the catalogue image crop. The original source review used 7,839 vertical rays for that rear living-room position. The subsequent v2 triangle review retains the camera and that entire zone while enabling the connected corridor and entry; the licensed model bytes and textures are unchanged.

The bake preserves diffuse static illumination, rather than transferring Blender's complete renderer. View-dependent reflections, transparent glass and the shadows of newly placed furniture still require runtime treatment. Final appearance has not yet been accepted against the catalogue reference.

## License and sharing

The listing is free to download under [Blendkit Royalty Free](https://www.blendkit.com/docs/licenses/); it is not CC0. Source and generated binaries stay local in ignored storage. Commit the preparation script, metadata and attribution, not the downloaded source or converted asset as an independently reusable model. Teammates acquire the asset through Blendkit and run preparation locally. Production packaging includes the GLB as part of the application; review distribution terms for any public deployment.
