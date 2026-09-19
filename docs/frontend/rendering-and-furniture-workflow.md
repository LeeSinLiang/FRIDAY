# Rendering engine and furniture asset workflow

2026-09-19 · Research and proposed collaborator handoff. No assets generated or benchmark run.

## Recommendation for the current scope

Keep Three.js through React Three Fiber for the laptop room editor. Deliver separate GLB furniture assets regardless of renderer. Use Blender as the final dimension/material/pivot check, with existing licensed models, manual modeling, or Higgsfield mesh generation as inputs. The rendering foundation can proceed with test blocks while a collaborator prepares furniture.

The current deliverable is a grid, empty example room, camera controls, and editable furniture. Room reconstruction belongs to another teammate. Spatial validation and the valid-space overlay come later. See the [furniture collaborator handoff](3d-object/collaborator-handoff.md) for the first asset deliverables.

## Three.js/R3F versus PlayCanvas/SuperSplat

Three.js and PlayCanvas are rendering engines. R3F integrates Three.js with React. SuperSplat supplies tools for editing and publishing Gaussian splats; it is not itself the furniture-shopping application.

| Concern | Three.js + R3F | PlayCanvas + SuperSplat workflow |
| --- | --- | --- |
| GLB furniture, grid, drag, rotate | Fits existing scaffold; implement our editing rules | Also supported; still implement our editing rules |
| React UI integration | Existing R3F setup | PlayCanvas also has React bindings; integration is possible |
| Mesh room from reconstructed floor plan | Direct fit | Direct fit; SuperSplat is unnecessary for a mesh-only scene |
| Scanned Gaussian-splat room | Add a renderer such as Spark and verify compatibility | Integrated splat tooling, editing/publishing, and engine features |
| Placement/clearance rules | Application geometry and metadata | Application geometry and metadata; generic collisions do not implement our rules |
| Best reason to choose it here | Continue the current interactive-editor foundation | Teammate supplies splats and their editing/streaming/rendering workflow dominates the project |

Neither renderer automatically creates realism from an empty room or a floor plan. Mesh appearance comes from geometry, textures, lighting, shadows, and composition. Captured splats can preserve realistic appearance, but need preparation for replacing individual objects, filling unseen regions, physical dimensions, and mixing with new furniture. Separate GLB furniture remains a useful interface in either engine.

Do not assume splats cannot be interactive: PlayCanvas documents picking, shadows, relighting, and collision-generation tooling. Those features do not establish accurate furniture dimensions or product semantics by themselves. Three.js also supports a hybrid route through Spark. No comparative performance benchmark has been run for this project.

Sources: [PlayCanvas GLB importing](https://developer.playcanvas.com/user-manual/assets/models/), [PlayCanvas React assets](https://developer.playcanvas.com/user-manual/react/guide/loading-assets/), [splat application features](https://developer.playcanvas.com/user-manual/gaussian-splatting/building/), [SuperSplat collision generation](https://blog.playcanvas.com/new-in-supersplat-software-attribution-collision-generation-and-histogram/), [Spark for Three.js](https://sparkjs.dev/).

## How the furniture collaborator can create assets

1. Existing suitable model: import a licensed or team-owned model into Blender, verify dimensions/materials, simplify if necessary, export GLB. Recommended for speed and predictable results when such assets exist.
2. Simple furniture: model directly in Blender, including through scripted geometry where helpful. Tables, shelving, and simple cabinets are good initial candidates. Use measured dimensions and bevels rather than adding unnecessary detail.
3. Image-based draft: use Higgsfield's actual image-to-3D or multi-image-to-3D tools, then inspect and correct the GLB in Blender. Suitable for exploring upholstered or decorative forms when manual modeling would take too long. It is an experiment until checked in our browser scene, not a guarantee of accurate reconstruction.

The live Higgsfield catalogue checked in this session lists Meshy Image to 3D, Multi-Image to 3D (1–4 reference images), and SAM 3 3D Objects with GLB outputs. Meshy options include textures, PBR maps, remeshing, and target polygon counts. For furniture, request textures/PBR and disable rigging/animation. Use consistent photographs of the same object; unrelated or inconsistent generated views can disagree geometrically. Inspect legs, thin surfaces, backs, undersides, and silhouette. Correct scale against declared product dimensions; do not assume generation supplies measurement accuracy.

Higgsfield's ordinary image/video generators can make reference art, but a rendered picture or turntable video is not the editable GLB deliverable. Use the actual mesh-generation capability. No generation jobs were submitted during this research.

Sources: [Higgsfield's documented multi-image mesh workflow](https://github.com/higgsfield-ai/skills/blob/main/higgsfield-generate/SKILL.md), live Higgsfield model catalogue inspection, [Meshy image-to-3D documentation](https://docs.meshy.ai/en/api/image-to-3d), [Blender glTF materials/export documentation](https://docs.blender.org/manual/en/dev/addons/scene_gltf2.html). Blender exporter options depend on the collaborator's installed version.

## Proposed asset handoff

- One `.glb` per furniture product, with embedded textures and all furniture parts under one root. No room, camera, or studio lights in the furniture asset.
- Retain editable `.blend` source when Blender is used, plus the original references and source/license information.
- Export floor-level pivot at the center of the footprint; agree exported Y-up and +Z-front orientation. Verify the exported result because Blender authoring coordinates differ.
- Use supported PBR materials (base color, roughness, metallic, normal). Bake unsupported procedural materials; check GLB appearance in the target browser rather than trusting a Blender render.
- Supply stable product ID, thumbnail, and explicit `widthCm`, `depthCm`, `heightCm` metadata. These centimeter fields are the proposed application contract following the unit discussion; agreement with other owners is still needed.
- Initial performance budgets, not engine limits: around 10–30k triangles for a normal product, up to 50k for a hero sofa; 1–2k textures; aim below 5 MB per GLB. Adjust based on visual quality and measured performance of the complete room.
- Validate one sofa and one table end to end before preparing the entire catalogue: import, verify dimensions, place, rotate, duplicate independently, and inspect material appearance. A simple footprint box remains separate from detailed visual geometry for later validation.

## Centimeters in app data, meters in GLB files

glTF specifies meter-based linear distances. That file-format convention does not require our database or API to use meters. A 200 cm sofa can be exported as 2 m in GLB, represented as `widthCm: 200` in metadata, and rendered 40 scene units wide with `SCENE_UNIT_CM=5`.

```text
metadata centimeters -> scene units: cm / SCENE_UNIT_CM
GLB meters -> scene units: meters * 100 / SCENE_UNIT_CM
```

Keep GLBs physically scaled and apply the scene conversion once in the loader. Do not bake our configurable 5 cm grid into exported furniture files. Merely changing Blender's displayed unit labels is not sufficient evidence of correct export scale: re-import or inspect a known-size asset.

The proposed frontend contract uses centimeter-based app state and meter-based GLB assets. Confirm these handoff fields with other owners before integration; keep source units and loader conversion explicit. [glTF coordinate system and units](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units).
