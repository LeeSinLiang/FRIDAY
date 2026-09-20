# Furniture materialization

New furniture added after the first renderer synchronization materializes after its GLB finishes loading (or after the dimensioned fallback is selected). A 2.2-second bottom-up shader reveal reconstructs the model at its final position. Sparse champagne-gold surface filaments lead the reveal, with three long flowing strands and traveling highlights around the furniture. The rejected floating transparency effect has been removed. There is no scale, lift, position or whole-object opacity animation. The model retains its original blending/depth behavior, texture and vertex inputs; unrevealed fragments are discarded.

Existing furniture on initial room load does not animate. Product reloads do not replay automatically. Reduced motion skips the transition, including if the preference changes during playback. Replays cancel earlier transitions cleanly. Temporary cloned materials are restored and destroyed on completion, deletion, replacement and renderer disposal. Shadow casting is temporarily disabled during the reveal to avoid a full shadow from invisible geometry, then restored. Source GLB materials are never edited.

Implementation uses the pinned PlayCanvas 2.22 WebGL standard-material opacity/emission shader hooks. The reveal-height uniform changes each frame; goldenThreads.ts submits three short-lived curves through PlayCanvas drawLines. These decorative lines ignore depth for reliable visibility over splats and disappear on the next render after cancellation. There is no per-frame shader recompilation. World-space bounds are sampled at animation start. Authoritative pose, validation, persistence and independently built capture geometry remain unchanged.

## Frontend preview

Dispatch `new CustomEvent('friday:preview-furniture-materialize', { detail: { instanceId } })` on `window`. The active furniture layer replays only that existing instance. This is presentation only and does not add furniture or approve placement. The spatial agent uses its existing validated add command; successful new additions animate automatically. Failed commands do not create furniture and therefore do not animate.

Captures build independent static furniture hierarchies and show the final authoritative layout, never a partly transparent animation. No new animation or graphics dependency is used. The effect uses the existing render loop's browser frame scheduling and per-instance material copies; no particle system or postprocessing pass is introduced.

The selected-object inspector exposes **Preview summon** when the GLB is ready. It is disabled during active interaction, saves and capture UI. Open `/` (default Haussmann Gaussian room) or `/?room=haussmann-apartment`, place a sofa on a validated footprint, then replay. The empty room is only an optional small test fixture.

Verification: 127 scene tests and 16 packaging/auth tests pass; production build passes with existing chunk warning. Real browser tested GLB placement and selected-object summon replay; active and final rendered states inspected.

Default-room verification: real browser placed the GLB on an accepted Haussmann footprint and replayed Preview summon successfully; settled Gaussian-room screenshot inspected.

2026-09-20 refinement verification: rendered partial and settled GLB states inspected in Haussmann; no shader compilation failures observed. 127 scene + 16 packaging/auth tests and production build passed. Tests assert unchanged presentation transforms throughout the reveal, preserved blend/depth settings, restored materials/shadows, cancellation and reduced-motion handling. Shader integration reference: [PlayCanvas StandardMaterial](https://api.playcanvas.com/engine/classes/StandardMaterial.html).

Golden-thread refinement: verified active and settled states in the Haussmann Gaussian room using real Chrome. 127 scene tests and 16 packaging/auth tests pass; production build passes with the existing bundle-size warning. No additional media generation.
