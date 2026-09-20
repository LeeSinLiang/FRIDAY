# Alternatives for matching the Cg Arch reference

Research checked 2026-09-19 while the room export was being corrected. The goal is the selected bright interior, with laptop-local rendering, free first-person movement, movable furniture and the existing placement API.

| Approach | Benefit | Tradeoff for this project |
| --- | --- | --- |
| Blender lighting bake + existing PlayCanvas | Retains the source's static indirect lighting without calculating it every frame; preserves our editor and backend | UV preparation and bake verification required. A fully unlit room atlas needs separate dynamic furniture contact shadows. This is the current recommendation. |
| PlayCanvas runtime lightmaps | Built-in baking, soft direct shadows and ambient-light options; no renderer migration | Does not automatically reproduce the original Cycles scene. Source materials and lights still need translation, and baking adds startup work. |
| Shapespark | Integrated architectural walkthrough workflow, UV preparation and baked lighting | Its authoring editor requires Windows 10/11, so it does not meet our local Mac workflow. Its SDK and movable-furniture workflow are also untested here. |
| Verge3D | Blender-oriented web export with support for additional material features | Commercial license; the listed one-person license is $290 and the team license $990. Still has differences from Blender rendering and requires integration work. Changing engines does not eliminate material and lighting preparation. |
| Three.js GPU path tracer | Progressive physically based rendering, area lights and environment lighting | Samples accumulate; image quality refines after camera/scene changes. Laptop performance and scene update cost need benchmarking. More suitable as a later still-preview mode than a rushed replacement for walking/editing. |
| Blender-rendered panoramas + Marzipano | Preserves the rendered room image at chosen camera positions; lightweight browser display | Rotation and transitions between fixed viewpoints do not provide arbitrary geometric walking. Furniture insertion, occlusion and shadows still require a separate 3D layer. |

These are engineering assessments from the documented capabilities, not measured comparisons on our Mac. No alternative package was installed and no migration was performed. A panorama is the clearest fallback if matching the reference image matters more than unrestricted movement; the baked mesh remains the best fit for the complete editor requirements.

## Primary sources

- [PlayCanvas runtime lightmaps](https://developer.playcanvas.com/user-manual/graphics/lighting/runtime-lightmaps/): lightmap generation and controls; avoid applying the same light both baked and dynamically.
- [Shapespark](https://www.shapespark.com/): integrated architectural browser presentations with baked illumination.
- [Shapespark authoring requirements](https://help.shapespark.com/hc/en-us/articles/360008894977-What-are-the-system-requirements-for-creating-scenes): Windows editor requirement.
- [Verge3D Blender lighting and rendering](https://www.soft8soft.com/docs/manual/en/blender/Lighting-and-Rendering.html): supported lighting and differences from Blender.
- [Verge3D licensing](https://www.soft8soft.com/licensing/): current commercial license options.
- [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer): progressive sampling, scene updates, area lighting, low-resolution fallback and raster fallback.
- [Marzipano](https://www.marzipano.net/): JavaScript panorama viewer and fixed panorama scenes.

For the implemented asset and remaining verification, see [Cg Arch interior](cg-arch-interior.md).

## Open-source replacement for the custom baker

The current walls and cabinetry remain visibly mottled. The defect is present in the baked asset, not just PlayCanvas. A single 2048 atlas for the architecture, low sampling and filtering across small UV charts are quality risks; the exact contribution of each has not been isolated. A renderer migration alone would retain a damaged lightmap.

The closest workflow replacement is [The Lightmapper](https://github.com/Naxela/The_Lightmapper), GPL-3.0: Cycles GI baking with per-object resolution, UV margin/unwrapping, HDR encoding and denoising. Unlike our joined whole-room atlas, it provides controls for each object. Local testing on Blender 5.2.1 found that official release 0.7.0 fails on import (`No module named bgl`). The official Lightmapper-One WIP branch imports and registers successfully in an isolated background process. Registration is not proof of baking or browser fidelity; a one-cabinet bake is the next gate. Neither was installed into the user's GUI preferences. Evidence and downloaded upstream code are in ignored `.room-preparation/lightmapper/`.

[Godot LightmapGI](https://docs.godotengine.org/en/stable/tutorials/3d/global_illumination/using_lightmap_gi.html) offers automatic secondary UV generation, GPU-baked indirect lighting and an integrated engine workflow. Web builds can display desktop-baked lightmaps, but cannot bake them in the web editor. Adopting Godot requires migrating the viewer, interactions and integration; it does not preserve arbitrary Blender material graphs automatically. It is a substantial alternative, not a fast drop-in fix.

[PlayCanvas runtime lightmapping](https://developer.playcanvas.com/user-manual/graphics/lighting/runtime-lightmaps/) explicitly does not bake global illumination. It can replace the ugly atlas with clean simpler lighting, but cannot be presented as reproducing the reference's Cycles bounce light. Browser path tracing remains a separate renderer integration with progressive convergence and unmeasured laptop performance.

For the hackathon, keep the editor and evaluate a small The Lightmapper proof before committing more time. If that fails compatibility or fidelity, a room asset already prepared and verified for real-time rendering avoids spending the remaining budget on this source scene. None of these choices is a guaranteed one-click Cycles-to-web conversion.
