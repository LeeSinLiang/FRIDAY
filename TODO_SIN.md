# Sin — tasks and agent work log

Condensed on 2026-09-20. Keep this file to current status, evidence, blockers, and handoffs; detailed rationale belongs in the linked docs and Git history.

## MUST DO — shared Haussmann room test

- [ ] **Prepare and verify the shared Haussmann room locally** — required for each collaborator.
  - Source: [HAUSSMANN APARTMENT](https://superspl.at/scene/4de797f4), Stéphane Agullo (sa3d), CC BY 4.0. Retain the license. This is an authored test room with assumed, not measured, scale.
  - The browser now downloads missing room files automatically from `/rooms`; the manual ZIP preparation and surface-review path remains documented in [the room handoff](docs/frontend/room-capture/haussmann-apartment.md).
  - Local preparation and verification are still pending for each collaborator. Known limitations: assumed scale and downward/ceiling/window visual artifacts.

## In progress

- **Prepare integrated demo for reviewed merge and push** — owner will push; local commits prepared with further verification deferred and the latest speech upgrade excluded. Inspected branch/main overlap and ignored credential paths, documented review groups and release gates in [merge preparation](docs/handoffs/demo-merge-preparation.md). Current `main` contains the first GLB batch; batch 2 is integrated. Full design backend: `431 tests / OK (skipped=4)`; frontend `255 + 29 passed`, build `4.83s`. Latest speech-model changes are excluded; the prior tested voice implementation is retained. No git mutations or remote writes. Latest backend before batch-2 completion: `Ran 429 tests in 17.637s / OK (skipped=4)`. Board card: `713a93fe-f3cc-42f7-b914-45f91b5aa64b`.

- **Restore room cart overlay and conversational sandbox checkout** — Astra presentation lane recovers the local-history cart preview/dispatch film into a translucent overlay; Astra integration lane sequences panel exit, real cart review, explicit confirmation, MFA and existing sandbox APIs; backend lane independently runs the full suite and reviews the API contract. Keep room mounted, hide panels before cart reveal, play dispatch only after confirmed sandbox acceptance, and preserve account requirements. Physical microphone testing is owned by the user. Board card: `672d6b32-d058-4dfb-a997-d66054c93318`.
  - In progress: implementation and browser acceptance; no Visa submission is authorized by the coding tests.


- **Polish Japandi room UI and golden threads** — existing warm panels and per-item gold threads implemented. Additional user-requested premium pass now assigned to Sol `premium_visual_assets`: inspect existing UI, generate restrained custom artwork with Codex imagegen, and integrate into design presentation. Checkout/voice/controller ownership stays with the active integration agents; new lane coordinates before any shared-file edit. Generated `frontend/public/artwork/golden-fate-filament.png` is integrated via design-variants.css; build `4.36s` passed. Browser visual acceptance remains pending. Board card: `46895741-99e9-46eb-8b51-e085ed458efd`.

- **Add Hey Friday wake detection and spoken replies** — automatic room-load attempt, remembered stop state, natural intent routing, GPT-Transcribe alternative, `/api/speak`, recorded wake recognition, playback echo suppression, and cleanup are implemented across the voice helpers/editor/shelf/backend speech paths. Provider/model names are hidden in product UI; typed input and fallback messaging remain.
  - Focused frontend tests and build passed (`17` focused tests; build `7.49s`). Synthetic live wake passed HTTP 200 / Deepgram `101 ms` with the exact phrase “Hey Friday. Find a brown sofa.”
  - Physical acoustic verification is still open: the browser reached “Opening microphone” but did not reach listening in the observed session; cancel returned cleanly to idle. A separate synthetic TTS→STT round trip heard “Day Friday,” so strict wake matching remains intentionally enabled pending a real rehearsal. Board card: `c91b6711-e174-42aa-b293-5ae87a3e364a`.

- **Build Haussmann autonomous design variants and checkout** — target flow is prompt → three independent room drafts → sequential materialization of variation 1 → active-only brown-sofa refinement → selected full cart → explicit MFA/IDX Visa-sandbox handoff. Astra owns variants/UI, Sol owns cart lock-in/checkout, and Sin owns catalogue prerequisites, integration, and this record.
  - API smoke and isolation checks passed: three valid baskets, active-only sofa replacement, unchanged sibling drafts/scene, stale re-accept `409`, and anonymous checkout `401`. Browser rehearsal reached three drafts, sequential placement, switching, and visible cream-to-brown sofa refinement; it stopped before lock-in.
  - Recorded checkpoints include backend `Ran 408 tests ... OK (skipped=4)`, frontend `231 scene + 27 remaining passed / 0 failed`, and a successful production build with the existing large-chunk warning. No payment or Visa request was submitted.
  - Live natural-refinement evidence: chocolate-tone request changed only the active sofa (8.22 s); corner request moved only the lamp (10.15 s); unknown “styroom” asked for clarification with no mutation (3.74 s). Each preserved sibling drafts and saved scene, validated geometry, stayed within budget, and replayed idempotently. Focused backend rerun: `Ran 17 tests in 3.630s / OK`.
  - Remaining gates: final room-overlay checkout rehearsal and physical voice rehearsal by the user. Local MFA key and collaborator Visa key/certificate readiness were verified; no final sandbox submission was exercised. Board card: `ff31eac1-0f9f-4ec7-939e-887dd7e386c9`.

## Next / parked

- Continue the first-person PlayCanvas/SuperSplat pivot while preserving the legacy React Three Fiber route and Django contracts. First prove one independently calibrated splat plus one movable GLB; calibration is not yet established.
- Integrate collaborator GLBs/metadata, then run the final trackpad/reduced-motion/device rehearsal. Mesh/clearance validation and a valid-space overlay follow after the room coordinate contract is stable.

## Completed milestones

- **FRIDAY system architecture** — added `docs/architecture/system.md` with current browser, API, AI/search/voice, commerce, persistence, asset, deployment, and source-map diagrams. Verified the listed source boundaries; no runtime or deployment acceptance was claimed. Board card: `6631afd5-f8a9-4a86-84f3-3a753a652f63`.

- **Haussmann demo scope and handoffs** — added the [execution plan](docs/handoffs/haussmann-demo-execution-plan.md), [catalogue/asset handoff](docs/frontend/3d-object/haussmann-demo-catalogue-handoff.md), [realistic GLB production guide](docs/frontend/3d-object/realistic-glb-collaborator-production.md), and [rehearsal guide](docs/handoffs/haussmann-demo-rehearsal.md). Confirmed all 15 incoming GLBs remain additive, documented canonical synthetic prices, and validated three under-$1200 baskets. INDEX links and whitespace checks passed.

- **Haussmann gallery and asset delivery** — made Haussmann the first room, added an empty-room preview, and implemented background browser download/cache with progress, retry, cancellation, attribution, and missing-asset fallback. Frontend tests/build and the actual gallery → room route were checked; no backend completion claim was made for this frontend-only work.

- **Cart choreography and furniture materialization** — delivered the lazy cart preview/replay flow, reduced-motion and media-failure handling, and automatic PlayCanvas placement for accepted GLBs. Browser replay/summon checks passed; the work made no payment or backend mutation. User preference recorded: use cheaper Higgsfield models for future generation.

- **Gaussian room evaluation** — acquired and integrated the CC BY Haussmann fixture as an opt-in test room. The latest measured motion checkpoint was `53.5 FPS`, p95 `26.2 ms` over 30 seconds at 1280×720, warm-ready `569 ms`. The room remains assumed-scale and is not a calibrated reconstruction; visual defects and mesh fallback remain documented in [the room handoff](docs/frontend/room-capture/haussmann-apartment.md).

- **Room/editor foundation** — delivered the initial scene editor, placement/history/persistence, capture controls, fixed-room fixtures, GLB serving/packaging, PlayCanvas editor work, collaborator asset contracts, and bundled Mori fonts. Baseline tests/builds passed at the time; no sustained physical-device rehearsal, arbitrary-mesh collision, or measured scan accuracy was claimed.

- **Project-manager reliability** — changed board reads to fresh locked reads, writes to atomic replacement, and server updates to polling/SSE; added concurrency, recovery, and shutdown tests. Standalone board tests passed. The optional Copilot canvas host remains unverified.

## Shared handoffs and constraints

- Do not claim calibrated reconstruction, physical microphone/speaker quality, Visa approval, or an end-to-end purchase until that path is observed and recorded.
- Preserve the current working tree and concurrent ownership. Owner retains all remote pushing and merging; local commits only. No direct main push, deployment or credential logging.
- Saketh-owned shared changes to remember: the region solver uses 5 cm samples and drops unsupported stacking/opening clauses; scene persistence uses SQLite contention handling plus quiet save retry. Details: [region solver](docs/frontend/region-solver.md) and [scene API](docs/backend/contracts/scene-api.md).
- After any merge, run the full backend suite and frontend build on fresh `main`; report the exact output. Keep the matching Sin Kanban cards synchronized with this file.

## Condensed historical record

- 2026-09-19: researched and documented the PlayCanvas/room-reconstruction pivot, rendering alternatives, scan calibration limits, GLB contracts, and the initial editor architecture. Documentation was indexed and link/whitespace checks passed.
- 2026-09-19: implemented and verified the early room editor, placement validation, save/reload, capture jobs, asset serving, and prepared-room fixtures across the frontend/backend. Temporary test servers were stopped after checks; large Three.js chunk warnings remain known.
- 2026-09-19: repaired project-manager cross-process persistence and documented the local board workflow; Git/manual edits still require board processes to be stopped.
- Older design references, research notes, merge details, and repeated test checkpoints were intentionally folded into the linked documentation and repository history to keep this work log operational.

- New Flux/configurable TTS upgrade explicitly deferred by owner to ship the working release. Prior GPT-Transcribe STT and Deepgram Athena TTS retained; no physical microphone test or actual sandbox approval claimed.
