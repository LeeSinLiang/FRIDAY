# Agent-observation shopping choreography

Branch: `codex/shopping-cart-animation`. Open `/?cartPreview` (defaults to the real Haussmann Gaussian room), or use Cart preview in the room header. This replaces the rejected ecommerce-style checkout page.

## User experience

The user watches. When the room renderer and session are ready, luminous agent markers bring sofa and table thumbnails into a floating glass cart. The order assembles, then the existing Higgsfield origami courier plays in a soft floating portal over the room. A completion message closes the visual story. No quantity selectors, purchase buttons, prices or storefront product list remain. A collapsed Developer controls disclosure exposes replay for testing.

This is simulated agent choreography with fixed sample thumbnails, not live sourcing or fulfillment. It performs no scene edits, checkout, payment or fulfillment requests. The room session still loads normally via GET. The observer renderer disables editing, keyboard undo/delete and pointer interaction; normal room editing remains unchanged outside this preview.

## Timing and integration

- Room-ready gates the sequence; a 25-second loading watchdog reports failure rather than playing over a missing room.
- Gather: 4.8 seconds. Compose: 1.7 seconds. Dispatch: the existing six-second film, completed by its ended event.
- Reduced-motion preference shows the final static state, skipping travel and video. A preference change during playback stops the film.
- Playback failure or a 15-second stalled-video watchdog reports an error; developer replay restarts the sequence. No fabricated successful transaction is shown.
- `frontend/src/checkout/previewOrderDispatch.ts` exports `previewOrderDispatch()`, dispatching `friday:preview-order-dispatch`. A mounted preview restarts its presentation. No SDK tool or backend event subscription is implemented yet.

## Files

- `frontend/src/checkout/CartPreview.tsx`: observation sequence and media lifecycle.
- `frontend/src/checkout/cart-preview.css`: full-room choreography and Atelier surfaces.
- `frontend/src/SplatEditor.tsx`: additive observation mode using the same Gaussian renderer, with editing disabled.
- `frontend/src/App.tsx`: lazy query route.

## Asset provenance

Higgsfield Seedance 2.5 job `d463f33f-1663-4104-aea3-ce6fee86f1fe`, generated 2026-09-20, six seconds, 720p, 16:9, audio disabled. Files: `frontend/public/animations/order-dispatch.mp4` and JPEG poster. Reused for this redesign without any further paid generation. The user requests cheaper models for future generations; do not reuse Seedance 2.5 without an explicit new request.

Product thumbnails come from the existing shared furniture catalogue. The Haussmann room retains Stéphane Agullo / CC BY 4.0 attribution. Its scale remains assumed; this animation does not improve spatial accuracy. Local ignored Haussmann assets are provisioned in this worktree.

## Exact original generation prompt

One continuous 6-second premium 3D motion design shot for a Japandi furniture shopping app. Locked camera, landscape 16:9. Seamless warm ivory studio backdrop hex F5EFE6, matte cream floor, soft realistic shadows. Center-left a delicate sculptural brushed champagne metal shopping cart holding one small cream folded order envelope sealed with a terracotta wax dot. At 0-1 seconds cart rests. At 1-2 seconds an elegant ivory origami swallow with terracotta inner wings flies gracefully in from upper left, precise paper folds and restrained luxury materials. At 2-3 seconds bird delicately grasps the envelope by its top edge with beak, lifts it cleanly out of the cart. At 3-5 seconds bird with envelope arcs gracefully toward a small terracotta arched dispatch portal on right, paper wings beat fluidly, trailing very subtle warm light particles. At 5-6 seconds bird and envelope pass through portal and disappear, leaving empty cart and quiet scene. Elegant cinematic soft daylight, physically plausible paper and satin metal, beautiful choreography, no cartoon face, no humans, no typography, no labels, no logos, no camera motion, no cuts, no sound.


## Verification

Verified automatic room-ready sequence, gather/dispatch/completion screenshots, hidden developer replay, reduced motion, media failure without false completion, replay recovery, keyboard non-mutation, mobile overflow and zero POST requests. Observer capture worker disabled. Frontend tests: 127 scene + 16 packaging/auth passed; production build passed with existing chunk warning. Both feature documents indexed. Local full-stack launcher uses frontend 5230 and isolated backend 8230. Earlier ecommerce tests are superseded by this hands-off sequence.
