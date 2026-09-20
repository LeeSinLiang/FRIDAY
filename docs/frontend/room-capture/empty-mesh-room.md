# Empty mesh room

The `?room=empty-room` route provides an authored 600 × 500 × 280 cm interior. It has a floor, ceiling, four walls and a 100 × 220 cm doorway. It starts with an empty saved layout and offers the shared textured GLB sofa. The default editor now uses the selected [Cg Arch interior](cg-arch-interior.md). Studio 11 remains available at `?room=studio-11`; its session layout is separate. The earlier Three.js editor remains at `?legacy`.

## Assets and coordinates

Run `node frontend/scripts/generate-empty-room.mjs` from the repository root to regenerate `shared/rooms/empty-room/room.glb`, `manifest.json`, `spatial.json` and `license.txt`. The generator checks GLB roundtrip bounds for the floor, walls, ceiling and doorway. Geometry uses meters; the manifest and editor use centimeters with the existing render-unit conversion. Interior floor bounds are x=0..600 and z=0..500 cm at y=0. Walls extend outward from these bounds.

`scan.visualFormat: "glb"` selects a container asset; omitted format retains splat compatibility. The existing `scan` envelope is retained to avoid breaking prepared-room and agent contracts. Mesh readiness waits for a rendered frame, not a Gaussian sorting event. Mesh previews use antialiasing and device pixel ratio up to 1.5; splat performance settings are unchanged.

## Interaction and limits

Placement uses the exact interior rectangle, existing rotated furniture footprints and room height checks. This is analytical collision matching this simple mesh, not arbitrary triangle-mesh collision. Navigation retains its 20 cm half-width clearance and stays inside the rectangle, including at the doorway; exterior traversal and doorway clearance reservations are not implemented. The local 5 cm grid and green/red footprint appear during placement. Floor-plan view and captures remain schematic; first-person captures render the actual mesh and GLB furniture.

This fixture is authored and dimensionally exact by construction, marked `synthetic_demo`; it does not validate scan reconstruction or real-world measurement accuracy. No capture/training dependency is required. The generator creates plain materials and subtle floorboard seams; photorealistic textures and lighting are outside this fixture's scope.

## Verification

GLB roundtrip dimensional checks, frontend readiness/interaction tests, backend room isolation and wall-overlap rejection, and production packaging are verified. Browser checks cover room loading, GLB placement with green footprint/grid, rejected out-of-bounds numeric move with unchanged pose, and capture output. See `TODO_SIN.md` for final run counts and any remaining manual checks.
