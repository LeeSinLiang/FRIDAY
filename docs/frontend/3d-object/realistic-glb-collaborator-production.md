# Collaborator handoff: build realistic furniture GLBs for FRIDAY

2026-09-20 · For collaborators producing assets for Sin · Haussmann apartment demo.

## Your task

Build a realistic, textured furniture model that we can load, rotate, move and buy as a synthetic demo product in our existing app. Deliver the actual **GLB**, a thumbnail rendered from that GLB, and measured metadata. A nice reference image alone is not a finished asset.

Our demo is a warm Japandi bedroom: the user asks for a $1200 room with a couch beside the bed, sees three designs, and changes the active design's couch to brown. Furniture should read as a coherent collection: warm oak, oatmeal/cream linen, restrained warm brown, soft edges, visible fabric and wood texture. Use real geometry where the silhouette depends on it. No room mesh, baked floor shadow, showroom backdrop, text or branding inside the furniture asset.

This is a generic synthetic catalogue. You may invent the design; do not label a generated approximation as an IKEA or other real retail product. Prices and catalogue integration are handled centrally.

## Claim one assignment before generating

Tell the coordinator which asset ID you are taking, your intended dimensions, and your ETA. Do not duplicate another person's work. Work only in your own asset folder/branch; send an early preview so a bad silhouette is caught before cleanup.

**Highest priority: a matching cream sofa and warm-brown sofa.** Build one believable two-seat sofa mesh and make two upholstery variants. Target approximately **180 cm wide × 85 cm deep × 80 cm high**; these are design targets, not measurements to fabricate. Keep wood/metal parts unchanged between variants. Use the same geometry, origin and dimensions where possible. Suggested IDs are `japandi-sofa-cream` and `japandi-sofa-brown`; confirm they are unused before starting. Deliver two self-contained `model.glb` files so changing catalogue products visibly changes the upholstery. An armchair does not replace the couch requirement.

**Already assigned/built elsewhere: do not regenerate these unless the coordinator explicitly hands one over.** All 15 are staying in the catalogue:

- Bedroom: oak wardrobe, three-drawer dresser, nightstand.
- Dining: round pedestal table, rattan chair, oak bench.
- Living: linen armchair, boucle pouf, slim console.
- Lighting/decor: paper floor lamp, ceramic table lamp, flatweave rug.
- Storage/decor: open bookcase, sideboard/TV unit, fiddle-leaf fig.

The wardrobe, dresser and nightstand were reported still finishing when this handoff was prepared; check their producer's current status. An oak platform bed already exists. Useful parallel work is sofa geometry, its brown material variant, and independent QA of delivered models—not three people generating another bed.

## Production workflow

### 1. Establish one consistent reference

Use a team-owned/licensed model if it already fits. Otherwise use the working pipeline: generate a four-view furniture turnaround, crop four separate views, then use Meshy multi-image-to-3D through the team's available generation tool. A simple cabinet/table can also be modeled directly in Blender.

A reusable image brief:

> Create a realistic product turnaround of one generic warm Japandi two-seat sofa. Oatmeal linen upholstery with fine fabric weave, low warm-oak legs, softly rounded arms, plausible cushion seams and comfortable proportions. Show exactly the same object in front, three-quarter, side and rear views, with consistent dimensions, cushions, materials and leg count. Isolate it against a plain neutral background under soft even studio light. Entire object visible in every view. No room, accessories, labels, logos, people or dramatic cast shadows. Design target: approximately 180 cm wide, 85 cm deep, 80 cm high.

Replace the object/material brief for your agreed assignment. The images are visual references, not proof of dimensions. Inspect all four views before spending a 3D generation: reject changed leg count, cushions or construction between views. Send individual crops of the same object; do not feed a montage as though it were one view.

### 2. Generate or model the geometry

For the existing generation route, use the current Meshy multi-image-to-3D tool available to your account, with textures and PBR enabled and animation/rigging disabled. Check the tool's current input requirements rather than assuming an old API parameter name. Keep the job ID, original references and raw output for provenance.

Aim for one usable object quickly. For the sofa pair, derive the brown version from the accepted cream mesh: change upholstery material/texture, preserve normal/roughness detail and preserve the wood color. Do not simply tint the entire sofa brown, including legs. If upholstery and frame share one atlas, use an appropriate mask or edit the texture regions. A newly generated second sofa may differ in geometry; if used, measure it separately and tell the integrator that it is a replacement shape.

### 3. Inspect and clean the exported model

Open in Blender or another GLB-capable inspection tool. Check front, rear, both sides, top, and underside. Remove stray/background geometry, floating scraps, duplicated faces and accidental pedestals. Check that legs meet the floor, arms are connected, seats are usable, and the back is finished. Fix missing textures, obvious holes and implausible proportions before spending time on tiny details.

Use standard glTF PBR materials. Bake unsupported procedural materials to textures. Embed textures in the GLB; keep **1024px** maps. Do not add a new decoder/compression dependency to the app. Keep Blender sources, raw 3D outputs and reference boards outside the runtime asset folder, in your private scratch/source delivery location.

Export only the furniture with intended transforms. No cameras, lights, room, animation or rig. Browser lighting will provide the illumination: do not bake a studio's sunlight or ground shadow into the base color.

### 4. Fit and measure the final GLB

Our export contract is:

| Property | Required |
| --- | --- |
| Units | Metres in the GLB |
| Axes | X width, Y height, Z depth; +Y up, +Z front |
| Origin | Floor level at Y=0; X/Z bounding footprint centred |
| Dimensions in metadata | Centimetres; listing integration uses integer millimetres |
| Typical budget | At most 30,000 triangles and 5 MiB per GLB |
| Textures | Embedded, 1024px preferred |

Do not rescale a model for the app's grid. A 180 cm sofa is 1.8 metres wide in the GLB. Blender authoring axes can differ; verify the exported file.

From the repository root, measure any delivered GLB without changing it:

```sh
python3 - path/to/model.glb <<'PY'
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd() / 'backend'))
from api.glb import measure
print(json.dumps(measure(Path(sys.argv[1])), indent=2))
PY
```

The measured size is **X/Y/Z = width/height/depth in metres**. Multiply by 100 for centimetres; metadata order is width/depth/height. Record actual min/max, bytes and triangles.

If fitting is needed, work on a copy first. For the sofa example:

```sh
# Uniform fit to a chosen 80 cm overall height; centres and grounds the model.
python3 scripts/fit_glb.py path/to/model.glb 80
```

The optional boxed form is `python3 scripts/fit_glb.py path/to/model.glb 180 85 80` (width, depth, height, centimetres). It caps anisotropic distortion at 10%. It **writes the model even if it exits 1** for a remaining dimension mismatch: read its output, remeasure, and do not treat failure as “unchanged.” Uniform-height fitting only verifies height; exit 0 does not prove correct width/depth or orientation. The fitter does not repair an incorrect front/up axis. Its printed box is width/depth/height, but residuals are width/height/depth. Do not refit an already fitted delivery blindly. Keep the raw export so you can compare or revert.

For a generic product, sensible delivered proportions and honest measured dimensions are preferable to stretching it to match an invented brief. Agree material departures with the coordinator; never adjust metadata alone to conceal incorrect scale. Round dimension declarations consistently to millimetre precision, and preserve exact measurements separately. If `fit.scale` or `fit.residualCm` is recorded, it must describe the final file.

### 5. Render the thumbnail and proof views

Reimport the final fitted GLB. Render a clear three-quarter preview of the **delivered file**, with the entire object visible and its actual material color. Save `thumbnail.png`; a transparent background is preferred. Keep reference/generated concept images separate—they must not masquerade as the finished model's thumbnail.

Save front, side, rear and three-quarter QA images under `.scratch/` in your worktree or in your delivery bundle. For the sofa pair, use the same camera/light settings so the cream-to-brown change is obvious.

Do not run `scripts/render_catalogue_thumbnails.py` against shared files just to preview one unregistered asset: it reads the entire catalogue and rewrites `shared/catalogue-thumbnails.json`. The integrator can use that batch script after registration. Producers should render their own asset directly or request a coordinated preview pass.

## Delivery format

Deliver one folder per agreed ID:

```text
<asset-id>/
  model.glb
  thumbnail.png
  metadata.json
```

The integrator places it at `shared/models/furniture/<asset-id>/`. Do not duplicate it into `frontend/public/`. Deliver editable sources/reference images separately if available; do not include large `.blend` files or raw generator outputs in the runtime folder.

Use the actual `shared/models/furniture/oak-platform-bed/metadata.json` as the current metadata template. Replace its values with your own measurements and provenance; never copy its triangle count or dimensions. Include:

- Stable asset `productId`, matching runtime model/thumbnail URLs, agreed synthetic `catalogueListingId` (normally `demo-<asset-id>`).
- Measured `widthCm`, `depthCm`, `heightCm`; `assetUnits: meters`, `upAxis: +Y`, `frontAxis: +Z`, `pivot: floor-footprint-center`.
- `matchType: generic_visual_proxy` for invented designs.
- `source`: how references were made, generator/tool/job or model source, post-processing and licensing/provenance. Say there is no real retailer SKU and prices are synthetic demo data.
- `measured`: actual triangles, bytes, dimensions, materials/textures where measured.
- `knownLimitations`: anything the coordinator should know, including distortion, inaccessible interiors, merged materials, visible texture artifacts or unfinished inspection.

If metadata has a catalogue ID that is not yet registered, identify that as **pending integration**. Do not claim the full repository asset test passes: that test requires a matching authoritative listing.

## Quality bar before sending

- All textures survive GLB export and appear from every viewing angle.
- Dimensions, bottom and centre are measured from the final GLB. Current tests allow dimension error of max(2 cm, 3%), floor error of 1 cm, and X/Z centring error of 2 cm; target correct values rather than using tolerances as goals.
- No missing legs, floating fragments, merged background or baked floor/shadow plane.
- Material detail holds up near the camera and also reads clearly at room-view distance.
- Sofa variants preserve geometry/pose and change upholstery visibly. Two independent files have matching measurements if derived from the same mesh.
- GLB is at most 5 MiB and normally at most 30,000 triangles. Marginal 30–31k overages are acceptable for review with exact counts and a written reason; the integrator owns named exceptions. Do not weaken shared limits or silently decimate away important detail.
- Report defects openly. For example, a 258 × 242 cm generic rug must be described as that size, not as a 200 × 300 rug. A plant's bounds include its canopy, not just its pot.

You can mark an asset **measured and visually inspected**. The integration coordinator marks it **verified in Haussmann** only after real loading, orientation, placement and catalogue/cart checks. Those are different milestones.

## Shared-file boundaries

Work on a feature branch/worktree and only your claimed asset folders. Do not fetch/pull mid-task, push main, or overwrite files from an old branch. Follow current `AGENTS.md`; identify your owner TODO before writing a work log. Keep scratch captures under `.scratch/`.

Asset producers send the folder plus proposed ID/dimensions. The designated catalogue integrator owns `backend/catalogue/data/listings.json`, `shared/catalogue-thumbnails.json`, triangle exceptions, search ingest and shared scene data. Coordinate before editing those files. Do not pre-place products in Haussmann or edit the app UI.

The full [catalogue integration handoff](haussmann-demo-catalogue-handoff.md) defines all 15 inclusions, synthetic prices and integration tests. The [Haussmann execution plan](../../handoffs/haussmann-demo-execution-plan.md) explains how the app consumes them. This production brief supersedes stale renderer/fixture/budget assumptions in the older general collaborator handoff for the current demo.

## Copy this when handing back

```text
Asset ID(s):
Owner / branch / commit or bundle location:
Files: model.glb, thumbnail.png, metadata.json
Measured W × D × H (cm):
GLB bytes / triangles / texture sizes:
Units / axes / floor pivot checked:
Reference and generation provenance:
Views inspected and proof-image locations:
Known defects / requested exact-count exception:
For cream/brown pair: same mesh and dimensions? What material changed?
Status: measured + visually inspected / pending corrections
Pending integrator work: listing, thumbnail registry, asset tests, Haussmann check
```

Send the first usable result promptly, including imperfections. A transparent handoff with a real, textured GLB is more useful at this deadline than another polished concept with no model.
