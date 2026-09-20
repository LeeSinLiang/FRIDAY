# Haussmann bedroom demo rehearsal

2026-09-20 · Local rehearsal guide for the three-design bedroom and Visa IDX sandbox flow.

## Before opening the room

- Run `./setup.sh`, then launch the full stack with `BACKEND_PORT` and `FRONTEND_PORT` set to unused private ports. Present from the same machine at `localhost` or `127.0.0.1`.
- Use a fresh browser session for an empty guest cart and predictable account flow. Grant microphone access before the rehearsal if voice is part of the presentation; typing exercises the same design path.
- Open `/room/haussmann-apartment`. Wait until the room is visible and the loading overlay has cleared.
- Keep the 17 new demo model folders installed. The catalogue must include the priced bed plus `demo-cream-linen-sofa` and `demo-brown-linen-sofa`. The selected design cannot lock if any item lacks a current price, deployed model, or matching metadata.
- Confirm the Elasticsearch index agrees with the files using `cd backend && .venv/bin/python -m catalogue.index_check`. The expected current result is 12,154 listings and `AGREE`.
- Confirm the backend reports Visa readiness before the checkout beat. The current local file-based configuration reports `X-Pay and MLE configuration loaded.` Restart Django after changing `.env`; the approval button is disabled when readiness is false.
- Have either an existing verified FRIDAY account with TOTP MFA and acknowledged recovery codes, or be ready to complete the setup steps below. Keep the authenticator available for both sign-in and checkout approval.

## Rehearsal, click by click

1. In the furniture search field labeled **Describe what you are looking for**, enter exactly:

   > I have a $1200 budget. Design me a warm bedroom. I want a couch beside the bed.

   Click **Find**. The panel changes from **Designing your bedroom** to **Your three bedrooms** as the backend selects and geometry-checks the furniture. The viewport reveals the first design one piece at a time. Wait until the progress line says all three designs are ready and the **01**, **02**, and **03** buttons are enabled.

### Optional Hey Friday voice path

- In the room toolbar, click **Hey Friday** to explicitly enable voice. When the browser asks for microphone access, choose **Allow** and wait for the listening status.
- Give the request in one utterance, for example: **“Hey Friday, I have a1200dollar budget. Design me a warm bedroom. I want a couch beside the bed.”** The same command can be typed into the search field if audio is unavailable.
- For the active design's brown refinement, say **“Hey Friday, actually change the couch to a more brownish color.”** If using the two-step form, say “Hey Friday,” wait for “I’m listening,” then give the request within 12 seconds.
- Click **Stop Friday** when the voice portion is complete; it releases the microphone. Spoken replies use Deepgram's configured **Athena** voice (`aura-2-athena-en`), a professional feminine voice.
- Current evidence is limited to a live synthetic Athena TTS → `POST /api/transcribe?wake=1` check that returned the exact **“Hey Friday. Find a brown sofa.”** transcript with HTTP 200, `backend: deepgram`, and `101 ms` provider time. Physical microphone capture, acoustic wake detection, and speaker playback have not yet been verified; use the typed path as the fallback.

2. Click each numbered design button. Use the shared viewport to show that every tab is a complete independent arrangement. Each button shows its piece count and furniture subtotal; the note states that demo prices are synthetic and exclude tax and shipping. Return to **01**.

3. In **Refine selected bedroom**, enter exactly:

   > Actually, change the couch to a more brownish color.

   Click **Update**. Wait for the message that the selected design was updated and the other two are unchanged. Switch to **02** and **03**, then back to **01**, to demonstrate that only the active draft changed.

4. Press **Speak**, say **“OK, lock it in.”**, then press the finish button. Typing that phrase in the refinement field and clicking **Update**, or clicking **Lock in … →**, reaches the same lock action. Wait for **Saving this design and preparing checkout…**. The app freezes the active full scene, synchronizes that room's selected items to the cart once, and opens `/checkout`.

5. Complete the account gate shown on `/checkout`:

   - Returning account: enter email and password, then the current authenticator or an unused recovery code.
   - New local account: click **Create account**, submit email and password, open **Local test inbox**, click **Refresh inbox**, enter the latest email verification code, and connect an authenticator using **Show setup QR code**. Save the recovery codes and click **I saved my recovery codes — continue**.

   The guest cart is claimed only after the account is authenticated, email-verified, MFA-enabled, and recovery codes are acknowledged.

6. On **Bring it all together**, compare the visible cart pieces and total with design **01**, then click **Review checkout**. This creates an immutable server-priced checkout and opens `/checkout?checkout=…`.

7. On **Review your checkout**, read the item lines, quantities, vendors, and total aloud. Check the explicit approval checkbox. Enter a fresh six-digit authenticator code; if that code was just used to sign in, wait for the next code. Click **Approve and send to Visa sandbox** once.

8. Read the stored receipt. An accepted result says **Visa IDX accepted this request** and shows the transaction ID, HTTP response, IDX Match Key, encrypted-response verification, and transaction-ID match. End on the receipt's scope statement: **Payment authorization: not attempted. Vendor order: not created.**

## Recovery during rehearsal

| What the UI shows | Recovery |
| --- | --- |
| **Room unavailable** or a connection error | Click **Reload room** or **Retry connection**. Wait for the room and saved scene before submitting the design request again. |
| A design request is interrupted or reports a stale room/variant revision | Keep the returned message visible, discard the drafts, reload the room, and generate a fresh set. Do not try to lock a stale card. |
| The AI furniture-selection provider is unavailable | Continue with the three geometry- and budget-validated curated combinations. The panel explicitly labels this fallback. |
| The brown update is refused | Keep **01** selected and use the exact brown-couch sentence above. The focused refinement endpoint supports that change. |
| Lock-in returns an error | Do not navigate away. The draft remains visible. Resolve the stated price, model, budget, or revision problem, then use the same lock action; its request ID is retained for a safe retry while that draft remains mounted. |
| Account setup does not advance | Finish the current screen: email verification, authenticator enrollment, or recovery-code acknowledgement. Checkout claiming requires all three. |
| **Reconnect your cart** | Click it once. The app retries the authenticated cart claim and refreshes the cart before enabling **Review checkout**. |
| **Your cart changed** on checkout | Return to `/cart`, inspect the current items, and create a new review. The previous snapshot is superseded and cannot be submitted. |
| Wrong or reused authenticator code | Enter a new current code. A rejected code does not send a Visa request. |
| **Visa sandbox sending is unavailable** | Restore the private server credentials and restart Django. Do not bypass the disabled button. |
| **Submission in progress or awaiting confirmation** or a transport-unknown result | Click **Check stored status**. Do not approve again or create an automatic retry; the server may already have sent the one allowed request. |

## Current boundaries

- Drafts live in the mounted browser state. Refreshing or changing rooms before lock-in clears the three visible drafts; generate a fresh set instead of assuming the old active tab was restored.
- Draft previews do not change the saved room or cart. Only lock-in writes the active complete design. Discarding drafts returns to the previously saved room.
- Lock-in accepts only currently priced, packaged furniture and enforces the $1,200 furniture subtotal. The displayed subtotal excludes tax and shipping.
- Visa IDX returns transaction-context evidence and a Match Key. This project does not perform card authorization, capture, refund, or a merchant order.
- Checkout approval is explicit and bound to the immutable snapshot, current browser session, and a fresh MFA approval. The code sends one sandbox request from that action and does not automatically retry an uncertain result.

## Verification recorded for this handoff

- `OPENAI_API_KEY= COMPILE_LIVE_TEST=0 .venv/bin/python manage.py test` from `backend/` → `Ran 406 tests in 26.731s` / `OK (skipped=4)`.
- The current local Visa configuration loaded successfully and the local bootstrap reported ready; no Visa submission was made while preparing this guide.
