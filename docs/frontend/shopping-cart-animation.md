# Cart choreography

## Restored live-room checkout overlay · 2026-09-20

The latest user request supersedes the historical restriction on showing checkout over the room. `RoomCheckoutOverlay.tsx` now presents the real selection over the existing live room; it does not mount a second renderer or restore the standalone `?cartPreview` route. The parent room controller owns authentication, immutable checkout creation, explicit readiness, MFA approval and submission.

Room panels fade away first, then the warm ivory overlay and actual furniture lines arrive. Once a checkout exists, names, quantities and amounts come from its immutable snapshot; current cart thumbnails are only decoration. `onBillVisible(id, snapshotHash)` fires after entry motion (immediately with reduced motion) and only while the document is visible, so the controller can bind consent to the displayed bill. Closing and reopening preserves the controller's saved result, without submitting from the presentation component.

The authenticator input is local and clears after submission. Spoken codes are explicitly supported: speech is transcribed online, then the room controller intercepts the code before general intent routing or conversation history. Voice status redacts the code, including when verification changes the stage before the reply arrives. Neither presentation nor voice code logs an authenticator code.

The original six-second `/animations/order-dispatch.mp4` is recovered from the previous preview's local Git history and reused without new generation. It mounts **only** when the saved checkout says `accepted`, HTTP status is 2xx, the transaction ID matches, and an IDX Match Key exists. Approval, pending/unknown transport, failure and malformed evidence never play the film. Copy states that this is a verified sandbox request: no payment was charged and no merchant order was created. The bird is a symbolic demonstration, not fulfillment evidence.

Reduced motion skips travel and film. Playback rejection, media errors and a 15-second watchdog retain the verified result and offer animation replay; replay never submits a payment request. Keyboard focus stays in the overlay; Escape closes it and focus returns to the prior control. The original `/cart` choreography remains intact.

Files: `frontend/src/checkout/RoomCheckoutOverlay.tsx`, `room-checkout-overlay.css`, `roomCheckoutPresentation.ts`; presentation gates and immutable-price regressions live in `frontend/scripts/checkout-bill.test.ts`. Root's browser rehearsal verifies actual motion; unit tests do not establish visual quality or successful MFA/payment behavior.

## Earlier cart-only release (retained)

**Historical status, 2026-09-20:** the standalone cart preview (`/?cartPreview`) is retired. Its choreography now runs inside the real cart at `/cart`, over the real cart. The original preview is described under [History](#history-the-standalone-preview-retired); its route, page and event no longer exist.

## What ships

On `/cart`, once the account is ready, the shopper's own pieces gather into a small stage under the **Review checkout** button, then settle. "Bringing your pieces together." becomes "Everything, together.", with the bill line beside it ("2 items · 1 priced · $149").

- **The real cart, nothing else.** Every name, thumbnail, quantity and price is what `/api/cart/` returned. One tile per product: a product added three times is one tile reading `3 × $149.00`. A piece with no known price reads `price unavailable`, never `$0`. There is no sample data in the shipped path.
- **Empty cart:** no stage and no animation. The page shows the empty cart.
- **It never gets in the way.** The stage sits under the button and beside the cart summary, takes no pointer events, is `aria-hidden` (the cart summary carries the semantics) and gates nothing. Someone who wants to check out immediately can.
- **Hard line: sign-in, the authenticator step and the review step are untouched.** No WebGL, no room and no animation on them. Only `CartReady` mounts the stage, only when the path is `/cart` and the cart has items. Anonymous `/cart` *is* the sign-in step (the form is on that page), which is why the room backdrop was dropped rather than kept off those steps: the animation matters, the backdrop does not.
- **Reduced motion** (`prefers-reduced-motion: reduce`) goes straight to the finished state: no travel, no settle.
- **A long bill does not flood it:** the first seven lines, then "+N more · in your cart".
- **No "on its way".** Nothing has been ordered on `/cart`, so the dispatch film is not played there. The film and its poster stay in `frontend/public/animations/` (provenance under History) and nothing references them now.

Timing: each tile travels for 1.4 s and starts 0.32 s after the one before it, so two pieces are together after 1.72 s.

## Files

- `frontend/src/checkout/CartChoreography.tsx`: the stage. DOM and CSS only.
- `frontend/src/checkout/cart-choreography.css`: its styles and keyframes.
- `frontend/src/checkout/cartLines.ts`: cart items to lines, the price text, the stage cap. Dependency-free so node can test it.
- `frontend/src/shopping/CartReady.tsx`: the only place that mounts it.
- `frontend/scripts/checkout-bill.test.ts`: lines, prices, the cap, and source-level guards (no `cartPreview` route, no sample data, no room or film, not mounted by the sign-in, authenticator or review components).

Left alone on purpose: `frontend/src/SplatEditor.tsx` still has the `observation` mode the preview used. Nothing calls it now. It belongs to whoever owns the editor.

## A trap worth knowing

The first version kept an "already played" ref, set when the gathering *started*. React StrictMode runs mount effects twice in development, which is how the demo runs, so the second run saw the flag and jumped to the finished state: the pieces never gathered, 2 ms after mounting. Every test passed. It was found by looking at the page. The component now has no such ref: once together it stays together, and a timer that is simply started again is harmless. There is no DOM test renderer in this repo, so the animation itself is verified in a browser, not by the suite.

## Verification

2026-09-20, headless Chrome against a private stack (ports 8311/5311), one Amazon Berkeley Objects armchair with no known price and the IKEA HERRÅKRA armchair in the cart, put there through the editor:

- Signed out, `/cart` is the sign-in step: both real lines, `2 items · 1 priced · $149`, and `canvases: 0, videos: 0, choreo: 0, runningAnimations: 0`.
- Ready step: `is-gathering` at 154, 493 and 1,034 ms after mounting, `is-together` afterwards. Cart lines on screen at 344 ms, stage at 373 ms, **Review checkout** live at 395 ms, pieces together at 2,096 ms. The button's box ends at y 414 and the stage starts at y 442; the cart summary is the other column.
- A click on **Review checkout** 144 ms into the gathering went straight to the review step, where `choreo: 0, canvases: 0, videos: 0, allAnimations: 0`.
- The authenticator step on `/cart`: `choreo: 0, canvases: 0, videos: 0, allAnimations: 0`.
- Reduced motion: `is-together is-still` at the first look, tile transforms `none`, `allAnimations: 0`.
- Ready step with an empty cart: no stage, `allAnimations: 0`, the empty cart shown.

## History: the standalone preview (retired)

What follows is the original note for the standalone preview, kept for the record and for the film's provenance. `CartPreview.tsx`, `cart-preview.css`, `previewOrderDispatch.ts`, the `?cartPreview` route and the `friday:preview-order-dispatch` event it describes were removed when the choreography moved into the cart.

**Agent-observation shopping choreography**

Branch: `codex/shopping-cart-animation`. Open `/?cartPreview` (defaults to the real Haussmann Gaussian room), or use Cart preview in the room header. This replaces the rejected ecommerce-style checkout page.

### User experience

The user watches. When the room renderer and session are ready, luminous agent markers bring sofa and table thumbnails into a floating glass cart. The order assembles, then the existing Higgsfield origami courier plays in a soft floating portal over the room. A completion message closes the visual story. No quantity selectors, purchase buttons, prices or storefront product list remain. A collapsed Developer controls disclosure exposes replay for testing.

This is simulated agent choreography with fixed sample thumbnails, not live sourcing or fulfillment. It performs no scene edits, checkout, payment or fulfillment requests. The room session still loads normally via GET. The observer renderer disables editing, keyboard undo/delete and pointer interaction; normal room editing remains unchanged outside this preview.

### Timing and integration

- Room-ready gates the sequence; a 25-second loading watchdog reports failure rather than playing over a missing room.
- Gather: 4.8 seconds. Compose: 1.7 seconds. Dispatch: the existing six-second film, completed by its ended event.
- Reduced-motion preference shows the final static state, skipping travel and video. A preference change during playback stops the film.
- Playback failure or a 15-second stalled-video watchdog reports an error; developer replay restarts the sequence. No fabricated successful transaction is shown.
- `frontend/src/checkout/previewOrderDispatch.ts` exports `previewOrderDispatch()`, dispatching `friday:preview-order-dispatch`. A mounted preview restarts its presentation. No SDK tool or backend event subscription is implemented yet.

### Files

- `frontend/src/checkout/CartPreview.tsx`: observation sequence and media lifecycle.
- `frontend/src/checkout/cart-preview.css`: full-room choreography and Atelier surfaces.
- `frontend/src/SplatEditor.tsx`: additive observation mode using the same Gaussian renderer, with editing disabled.
- `frontend/src/App.tsx`: lazy query route.

### Asset provenance

Higgsfield Seedance 2.5 job `d463f33f-1663-4104-aea3-ce6fee86f1fe`, generated 2026-09-20, six seconds, 720p, 16:9, audio disabled. Files: `frontend/public/animations/order-dispatch.mp4` and JPEG poster. Reused for this redesign without any further paid generation. The user requests cheaper models for future generations; do not reuse Seedance 2.5 without an explicit new request.

Product thumbnails come from the existing shared furniture catalogue. The Haussmann room retains Stéphane Agullo / CC BY 4.0 attribution. Its scale remains assumed; this animation does not improve spatial accuracy. Local ignored Haussmann assets are provisioned in this worktree.

### Exact original generation prompt

One continuous 6-second premium 3D motion design shot for a Japandi furniture shopping app. Locked camera, landscape 16:9. Seamless warm ivory studio backdrop hex F5EFE6, matte cream floor, soft realistic shadows. Center-left a delicate sculptural brushed champagne metal shopping cart holding one small cream folded order envelope sealed with a terracotta wax dot. At 0-1 seconds cart rests. At 1-2 seconds an elegant ivory origami swallow with terracotta inner wings flies gracefully in from upper left, precise paper folds and restrained luxury materials. At 2-3 seconds bird delicately grasps the envelope by its top edge with beak, lifts it cleanly out of the cart. At 3-5 seconds bird with envelope arcs gracefully toward a small terracotta arched dispatch portal on right, paper wings beat fluidly, trailing very subtle warm light particles. At 5-6 seconds bird and envelope pass through portal and disappear, leaving empty cart and quiet scene. Elegant cinematic soft daylight, physically plausible paper and satin metal, beautiful choreography, no cartoon face, no humans, no typography, no labels, no logos, no camera motion, no cuts, no sound.


### Verification

Verified automatic room-ready sequence, gather/dispatch/completion screenshots, hidden developer replay, reduced motion, media failure without false completion, replay recovery, keyboard non-mutation, mobile overflow and zero POST requests. Observer capture worker disabled. Frontend tests: 127 scene + 16 packaging/auth passed; production build passed with existing chunk warning. Both feature documents indexed. Local full-stack launcher uses frontend 5230 and isolated backend 8230. Earlier ecommerce tests are superseded by this hands-off sequence.
