# Haussmann two-hour autonomous bedroom execution plan

2026-09-20 · Owner: Sin · Initial Luna/max audit; revised with Astra architecture, Sol asset integration, and Luna demo-data planning.

## Required demo

1. In the Haussmann apartment (`/room/haussmann-apartment`), say or type: “I have a $1200 budget. Design me a warm bedroom. I want a couch beside the bed.”
2. The agent picks and places furniture without manual dragging. The UI shows actual planning/validation progress and furniture appearing. Show exactly three complete, distinct bedroom designs in three cards/tabs sharing one viewport.
3. With variation 1 active, say “Actually, change the couch to a more brownish color.” Only variation 1 changes; variations 2 and 3 retain their exact snapshots. Preserve the bed and unrelated furniture in variation 1.
4. Say “OK, lock it in.” Freeze the visible design, synchronize its full furniture set to the cart, and open the existing checkout review.
5. Show the exact items and total, obtain explicit user approval and a fresh MFA code in the checkout form, submit once, and show the real stored Visa IDX sandbox result.

Completion means a real IDX sandbox acceptance. The existing integration does not authorize a payment or create a vendor order; retain that distinction on the receipt.

## What exists and what is missing

- Existing designer tools search models, place furniture relative to other objects, validate geometry, and commit a scene. Existing jobs expose before/planning/preview/after/verifying progress through polling.
- Existing PlayCanvas animations can show accepted furniture additions. Avoid introducing a new renderer, streaming transport, or animation system.
- Current jobs and client sessions hold one layout. Three independent full-room drafts and active-only refinement are new work.
- Current design intent recognizes certain leading action verbs. The user's complete conversational sentence must route reliably to design; test the exact wording, not only “design a room.”
- Existing model search does not enforce aggregate budget/style. Unknown prices must never be treated as zero-cost products.
- Synthetic seeded products/prices are explicitly approved. Include all 15 new GLBs alongside existing products. The model-agent handoff defines the canonical demo price sheet and cream/brown sofa priority; verify the final served catalogue matches it.
- Beds currently map to the sofa scene kind. Use real bed GLBs and stable bed references for this demo; broad category refactoring is outside scope.
- Existing cart checkout, immutable review, explicit approval, MFA and IDX submission are present. The missing commerce work is whole-design handoff and fresh end-to-end verification.

## Parallel implementation assignments

These are agent lanes, not reassignment of teammates' existing board ownership. One coordinator owns tracking, shared contracts, integration, and release decisions.

| Lane | Bounded deliverable | Exclusive files / boundary | Target |
| --- | --- | --- | --- |
| A — Agent/backend | Generate three independent full-room drafts; total budget enforcement; relative bed/couch placement; active-only refinement; selected draft acceptance | `backend/api/designer_agent.py`, `designer_jobs.py`, `designer_service.py`, focused designer tests; own draft contract | 55–70 min |
| B — UI/scene | Exact prompt routing; three design cards with a single viewport; real job progress; sequential furniture reveal; active-ID binding for refinements; lock-in handoff | `frontend/src/SplatEditor.tsx`, `scene/useRoomSession.ts`, `scene/designerIntent.ts`, `catalogue/CatalogueShelf.tsx`, `catalogue/SplatCatalogueLayer.tsx`, new small variant component/types and related tests | 55–70 min |
| C — Commerce/catalogue | Establish consistent priced, renderable demo candidates; sync all selected design items, excluding siblings; preserve approval/MFA; verify one IDX submission | `backend/shopping/`, `backend/checkout/`, catalogue fixtures/pricing boundary, `frontend/src/checkout/`, `frontend/src/shopping/CartReady.tsx`; coordinate fixture IDs with A | 40–60 min |
| Coordinator | Contract freeze, shared-file integration, actual-browser acceptance, full checks, release/rehearsal | `TODO_SIN.md`, Kanban, `INDEX.md`, scope doc; `App.tsx` only if needed | Throughout; last 40–50 min reserved |

Do not have two lanes edit the same file. B exports a lock-in callback carrying the selected draft identity and revision; C supplies the commerce handoff implementation. A owns backend design acceptance, C owns cart mutation; coordinator joins them. Do not change renderer internals unless an observed demo failure requires it.

## Minimum shared contract

Proposed contract, not an existing API:

- `variantSetId`, `activeVariantId`, exactly three `variants`.
- Each variant has stable `id`, `revision`, short label, full independent scene instances/commands, product identities, `totalCents`, and budget/geometry validation status.
- Mutation carries `variantSetId`, `variantId`, `baseRevision`, `requestId`, and the instruction. Resolve the target at request start; reject stale responses. Disable switching during a mutation for the first implementation.
- Persist drafts in existing job JSON where feasible; avoid a new database migration. Selecting a tab displays its snapshot without adding any sibling to the cart. Never shallow-share mutable instance arrays between drafts.
- Lock-in revalidates the chosen revision, accepts that scene, and synchronizes only its full item set to the cart with an idempotency key. Do not loop existing one-item confirmations without defining retry/partial-failure behavior. Preserve unrelated existing cart content unless the demo starts with an explicitly empty cart.
- Return observed progress from the existing polling path. Replay validated commands sequentially for visible placement; label that stage “Placing” rather than fabricating model reasoning or pretending rendering is ongoing inference.
- For brown refinement, prefer replacing with an actual brown model/listing while preserving the placement and rechecking footprint/budget. A material tint is only a design preview unless there is a matching purchasable SKU; do not silently sell the original color.

## Two-hour execution clock

| Elapsed | Required checkpoint |
| --- | --- |
| 0–10 min | Confirm prepared room, priced renderable bed/couch/brown alternative, configured agent, existing verified MFA account, and Visa readiness. Freeze contract and file ownership. |
| 10–65 min | Three lanes build in parallel. By minute 30, integrate one complete generated bedroom through the existing UI. |
| 65–85 min | Integrate three snapshots, active-only brown edit, and full selected-design checkout handoff. |
| 85–105 min | Run focused regressions, unlabelled backend suite, frontend tests/build, and real browser journey via the documented launcher on private ports. Repair only blockers. |
| 105–120 min | Rehearse and freeze. If release is authorized, reserve time for the documented paired deployment and stable-origin verification; do not claim local changes are deployed. |

This is an aggressive target, contingent on ready credentials/account and parallel integration. If the first ten-minute catalogue/account gate fails, surface it immediately. Broad live merchant purchasing cannot be added in this window.

## Mandatory acceptance

- Exact user prompt reaches design, with no manual furniture placement.
- Three full bedrooms have distinct stable IDs and visibly different arrangements; each fits within the $1200 known-price furniture subtotal. Make any excluded tax/shipping clear.
- Couch is beside the actual bed with valid footprint/clearance. Inspect an asymmetric off-centre arrangement in the real viewport, not only symmetric fixtures.
- While variation 1 is visible, brown refinement changes its couch only. Compare serialized snapshots of variations 2/3 before and after; both must be unchanged. Switch away/back to confirm persistence.
- Lock-in matches the visible variation and cart product IDs/quantities/price total exactly, with no sibling items and no duplicates on retry.
- MFA/consent remain explicit. Wrong or reused code fails; a fresh approved code enables the single sandbox submission. Keep codes out of general agent chat and logs.
- Read the actual stored accepted result, transaction ID, and verification evidence. Never auto-retry an ambiguous in-flight submission.
- Use `BACKEND_PORT`/`FRONTEND_PORT` with `./run-local.sh`; never occupy 8000/5173. Stop owned processes and check their listening ports at handoff.

## Cuts that preserve the requested story

Use Haussmann, all 15 new GLBs alongside the existing catalogue, a focused bedroom selection for each design, existing animations, three tabs with one viewport, and text input as the required path with existing dictation as optional. Three variants may reuse products with distinct validated layouts; all remain complete room designs. Prioritize the matching cream/brown sofa pair; defer unrelated additional asset generation, multi-room behavior, renderer polish, new onboarding, general version history, and automatic merchant purchasing. Do not cut three variants or active-only editing silently.

## Audit and status

Planning only: source/docs were inspected by Luna, Sol, and Astra agents; no application implementation, runtime tests, current credential readiness, or fresh sandbox transaction is claimed. Parent checked the current branch/diff. No fetch, pull, commit, push, or deployment performed. The temporary board HTTP launcher was denied loopback binding by the sandbox; tracking uses the board module's existing fresh-read/write-lock API instead, with no direct JSON rewrite and no running server.


## Confirmed decisions and model allocation

- [Model-agent handoff](../frontend/3d-object/haussmann-demo-catalogue-handoff.md) is the authority for all 15 new GLBs, defects, synthetic prices, and exact import files. Keep 1024px textures and approximately 40 MB total; no six-model exclusion remains.
- Implementation lane A: **Astra, high/max** for backend draft isolation, geometry and revision-safe acceptance (hard).
- Implementation lane B: **Astra, high/max** for live scene/draft state, active-only refinement, progress and renderer integration (hard).
- Implementation lane C: **Sol, high** for full selected-design cart synchronization, sandbox review integration and regressions (medium).
- Model-agent asset lane: **Luna, high** for deterministic listings, thumbnail rows, metadata and price edits; escalate geometry/export failures to **Sol**. The external model agent already owns generation. With three implementation agents plus coordinator filling available slots, run this separate model-agent handoff concurrently or use the first free slot; do not spawn beyond the limit.
- Coordinator keeps shared records current, resolves shared-file ownership, and runs integrated browser checks. More usage is available, but three variants still need bounded generation and capture latency.

## Concrete implementation order

1. Establish canonical synthetic IDs/prices and verify the existing Haussmann room, prepared geometry and final GLBs. Use 4–6 pieces per design. Leave all 15 searchable; do not place all of them in every variant.
2. In `designer_jobs.advance()`, add an explicit draft-completion path **before** the current `_commit()` call. Retain three independent `DesignState` snapshots in job JSON; do not let generating tabs commit three times. Keep accepted scene state separate from displayed draft state.
3. Generate three distinct layouts from the same room baseline, with stable bed/couch role IDs. Run capture/model steps serially within the job state machine to avoid capture races. Independent coding lanes run in parallel. Report actual draft readiness; no fake completed variants.
4. Expose `{id, roomId, baseSceneRevision, geometryRevision, activeVariantId, budgetCents, currency, variants}`. Each variant has `{id, revision, label, instances, products, roles, totalCents, geometryValidated, visualStatus}`. `roles.bed` and `roles.couch` identify instances, not catalogue labels. Visual status distinguishes reviewed from pending/unavailable.
5. Every mutation sends variant-set ID, variant ID, base variant revision, base accepted-scene revision, and request ID. Reads/writes remain scoped to the scene/session. Disable tab switching and accepted-scene undo/manual writes during refinement. Deep-copy state and reject stale responses.
6. Brown refinement starts from only that variant. Replace its couch with remove/add: the current move path rejects a product change. Preserve the bed and all other instances, validate footprint and price again, increment only the edited variant revision, and compare sibling hashes.
7. Lock-in validates all selected items are available, priced, and under 120000 cents. Existing checkout allows partial pricing, so this design-specific gate must be stricter. Apply a minimal accepted-scene diff and update the full selected cart atomically with the existing **cart-first, scene-second** lock order and idempotency. Keep this transaction owned by one lane with review from the other, not two competing implementations.
8. Open the existing checkout review. The user sees items/total, explicitly approves and provides fresh MFA in the form, then the app submits once and shows the stored sandbox receipt. Do not send MFA through model prompts or silently auto-approve.

## Haussmann-specific acceptance and time limits

The room manifest is approximately 660 × 940 cm, but its reviewed floor has holes and fixed obstacles. Validate actual floor footprints and obstacles; rectangular bounds alone are insufficient. Default camera is around (400, 200) facing +Z; start with a visible composition, then inspect perspective and top view. Determine exact furniture poses only after the final GLB dimensions are known.

Place the bed first and couch relative to its stable instance ID with an explicit gap/reference frame. `DesignState.candidates()` currently offers a bounded set (at most eight positions); failure is not proof that the entire room has no solution. Use a small set of measured alternative anchors/orientations if needed, then run the real validator.

The designer has a 12-command request cap. Four to six pieces fit comfortably from an empty editable room; clearing/rebuilding a furnished scene may not. Use a new demo session and a minimal diff, preserving unrelated saved rooms. Review tabletop support before auto-placing the ceramic lamp. Keep the rug browsable but do not place it underneath furniture until overlap semantics are verified. Keep the plant's conservative canopy footprint.

At minute 30, a single real agent-generated Haussmann bedroom must render. At minute 65, three independent draft cards and active-only refinement must integrate. If those gates fail, cut optional decorations/capture frequency/polish, not the requested three designs or isolation. Finish code by minute 85 and use the remaining time for tests, browser rehearsal and any authorized release. A local success is not a public deployment.


## Implementation checkpoint (2026-09-20)

Three parallel lanes implemented the app portion on the current feature checkout:

- `backend/api/designer_variants.py` and variant routes: three persisted independent drafts, real Agents SDK basket selection when available, explicit curated fallback, reviewed Haussmann geometry/budget checks, active-only brown replacement. Draft generation does not save the scene.
- `frontend/src/scene/{useDesignVariants,designVariants,BedroomDesignPanel}` plus editor/catalogue wiring: exact conversational prompt, progress, sequential materialization, three selectable designs, isolated refinement and lock-in. Existing viewport reused.
- `POST /api/checkout/lock-design/`: accepts the selected full design into its scene/cart atomically, preserves other rooms, and replays identical retries without adding duplicates. Existing account/checkout flow remains responsible for authentication and consent.
- `frontend/src/checkout/approveAndSubmit.ts`: one explicit approved MFA action sends the sandbox request once, with stored-result recovery if the outcome is uncertain.

Integrated verification: unlabelled backend `Ran 402 tests in 16.041s / OK (skipped=4)`; frontend `219 + 27 passed / 0 failed`; production build `built in 3.24s` with the existing chunk-size warning. These checks include real Haussmann geometry with synthetic test listings, not a current live asset/checkout claim.

Actual private-stack browser verified Haussmann rendering and the exact prompt entering the new “Designing your bedroom” progress UI. Full visual/checkout acceptance remains pending the external GLB agent's catalogue integration (no priced demo sofa in this checkout yet) and local Visa credentials. No merge, push or deployment claimed.
