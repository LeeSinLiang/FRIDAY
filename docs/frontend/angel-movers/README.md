# Angel furniture movers

Approved concept: [little white halo blobs](assets/halo-blob-concept.png), generated with the built-in image generator. The live characters use procedural PlayCanvas geometry: round white bodies, dot faces, rosy cheeks, short walking feet, pushing hands and golden halos. No external character asset or animation dependency is required.

## Behavior

A successful changed AI `try_place` / `attempt_placement` publishes `agentMotion` metadata in its existing command receipt: revision, instance ID, previous pose (null for a new item), and accepted target pose. Subsequent room snapshots expose it only at that exact revision. A user adding one new furniture item also receives the helpers after acceptance. Manual moves, drag previews, multi-command history restores, initial room loads, repeated polls, failures and dry runs do not create a new animation.

Two helpers walk up, push the object along its valid straight-line path, bounce at arrival, and walk away. New furniture receives a short 35 cm final nudge where space permits, preferring an approach from the camera-facing side so helpers remain visible. Furniture poses along transit are checked at 5 cm / 2 degree intervals against the existing placement validator. If no checked route is available, furniture appears at its accepted target and helpers celebrate there. This is a small visual effect, not a general pathfinding system.

The accepted scene state remains authoritative throughout; movement affects only the rendered furniture entity. Frozen AI captures use accepted poses and exclude helpers. Editing, top view, object removal and newer scene changes end the current effect. Camera-look gestures remain usable. Reduced-motion preference disables choreography. Only one two-helper team is shown at a time; a newer move replaces the previous effect.

For development screenshots, `?angelScreenshot=1` holds an active effect mid-push. It does not trigger a move and is disabled in production builds.

## Files and verification

- `backend/api/scene_service.py`: receipt-backed AI move and user-add motion metadata; no migration.
- `frontend/src/scene/useRoomSession.ts`: validated optional snapshot metadata.
- `frontend/src/scene/playcanvas/{angelBlob,angelMotion,angelMovers}.ts`: model, validated movement and animation lifecycle.
- `frontend/src/scene/playcanvas/interaction.ts`: scene/update integration.
- Backend event tests and frontend path/snapshot regressions cover accepted moves, manual changes, retries, invalid paths, and event replay identity.

Concept edit prompt used with the built-in image generator:

> Edit the previous concept image. Preserve the elegant sunlit Haussmann apartment, grey sofa, camera framing and dashed terracotta destination outline. Replace all three humanlike angel characters with adorable WHITE LITTLE HALO BLOBS: very short, round marshmallow glob bodies, entirely soft matte white, simple tiny black dot eyes and a tiny expressive mouth, no human head/body division, no hair, no skin, no robes, no clothes. Each character is a single plump white droplet/blob with two tiny stubby white feet and small rounded nubby arms, with a thin warm golden halo floating above it. No wings; keep the silhouette extremely simple and glob-like. About half sofa-arm height, much smaller than the previous characters. Two blob angels physically push against the sofa with little arms, leaning their squashy round bodies forward and visibly stepping with tiny feet; third blob walks near front corner guiding them. Charming soft 3D clay/marshmallow material, grounded contact shadows, clear pushing contact and walking poses, playful determined expressions. Not humanoid children, not ghosts with trailing tails, not floating: all blobs walk on little feet. Premium cute minimal mascots composited naturally into realistic room lighting. No text or UI.
