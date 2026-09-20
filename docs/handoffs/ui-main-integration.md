# Preserve William's UI while integrating into main

## 1. Source of truth and scope

William's checkout `/Users/williamxu/Desktop/Projects/hackmit2026`, branch `codex/room-cart-vercel` at `97f009e`, is the visual and interaction reference. Preserve its warm Atelier appearance, Mori typography, editor panels/toolbars, room gallery, placement confirmation, cart summary and account/checkout screens. This is integration, not redesign.

Read-only inspection on 2026-09-20 found local `origin/main` at `cac9880`, but live GitHub `main` at `0f44bc5530a529566fc94a04e0fe853138cb95a7`: 31 commits beyond that base. The UI branch adds four commits and changes 64 files against the old base. Live comparison used GitHub's compare API; no fetch, checkout, merge or deployment was performed for this plan. Recheck these refs at implementation time.

Keep the existing source branch and deployed release intact. Main contains newer renderer, floor/portal solver, catalogue and MFA-test fixes that must survive. Do not copy the entire frontend directory over main or resolve all conflicts with one side.

## 2. What to preserve and reconcile

| Area | Integration rule |
| --- | --- |
| Visual shell and screens | Preserve William's components, styling, fonts, labels and navigation. No new layout, theme or component-library migration. Capture desktop/mobile reference screenshots before integration. |
| `App.tsx` / `LegacyApp.tsx` | Keep the route boundary and lazy renderer. The large App deletion is primarily extraction into LegacyApp, not permission to delete the old editor. Preserve legacy entry points and upstream query aliases. |
| `SplatEditor.tsx` | Retain William's room prop, cart header and confirmation wiring. Add main's `roomId` query alias alongside `room`. Resolve room selection as explicit route ID, then `roomId`, then `room`, then the appropriate legacy default. Teach App to recognize both query aliases before its `/` redirect. |
| `SplatCatalogueLayer.tsx` | Keep explicit purchase preview/confirmation and idempotent retries. Retain main's `portalsFor(room.roomId)` argument to `useRegion`; do not regress placement across portals. |
| `CatalogueShelf.tsx` | Preserve styling and purchasability guards. Incorporate main's model-only results and truthful catalogue-total versus ready-in-3D count without changing the layout. Missing prices remain unavailable for checkout. |
| Room packaging | Keep `shared/public-rooms.json` authoritative for hosted gallery/assets. Main's new Haussmann default must not make a hosted deployment load missing binaries. Preserve Haussmann for the prepared local legacy workflow; publish it only after asset presence, attribution and hosting approval checks. |
| Renderer, region solver and assets | Keep main's Gaussian sort/capture fixes, floor-boundary/portal model, region overlay improvements, tests and furniture `matchType` metadata. These are functional improvements, not a replacement UI. |
| Shopping/auth/checkout | Integrate the matching Django shopping session, atomic placement/cart API, ownership, server pricing, recovery acknowledgement and checkout revision protections. Frontend-only copying would leave these screens calling absent endpoints. |
| Shared records/configuration | Merge TODO entries, INDEX links, environment examples and board tasks by identity. Keep teammates' entries and current card IDs/owners. Never replace whole shared records with the UI branch's older copies. |

## 3. Integration sequence

1. Confirm whether the demo freeze has started. If frozen, obtain explicit team approval before landing anything beyond a rehearsed-demo blocker. Have the owner refresh refs; do not silently fetch mid-task. Inventory uncommitted work and ignored room assets. Preserve the current UI branch as the reference.
2. Use an isolated integration checkout based on freshly synchronized main, without switching or disturbing the other worktree that owns local `main`. Run `./setup.sh`, the full backend suite, frontend tests and build before edits. Stop if baseline main is red.
3. **PR A — backend contract:** port shopping models/migrations/services, scene-session handoff, recovery acknowledgement and cart-backed checkout protections. Preserve current main's tests and catalogue behavior. Include required metadata/contracts and focused regression tests. Keep existing editor routes functional without the new frontend.
4. After A merges and fresh-main checks pass, start **PR B — preserved UI integration** from that new main. Port the gallery, route extraction, editor confirmation, cart/auth summary and real-cart checkout screens as one coherent flow. Resolve the specific overlaps above by hand. Compare against the reference screenshots and replay controls before review.
5. After B merges and fresh-main checks pass, start **PR C — deployment wiring** from new main. Carry Postgres/env configuration, shared JSON packaging, Vercel projects' runtime config, asset allowlist handling and source identity/release helpers. Include any settings needed earlier in A rather than leaving an intermediate PR broken. Do not recreate databases, replace existing encryption keys or copy local accounts.

The four existing source commits are reference material; the first mixes backend, frontend and deployment changes. Split by responsibility with reviewed hunks/dependencies, not blind cherry-picks of that large commit. Each PR must build and test independently. No push or PR creation is authorized by this planning request.

## 4. Verification and release gates

- At baseline, each PR and after every merge run `(cd backend && OPENAI_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test)`, `(cd frontend && npm test)` and `(cd frontend && npm run build)`. Quote actual output counts, not historical totals. Run migration-drift checks and apply migrations to an isolated test database. Keep main's new tests; do not weaken assertions to make the integration pass.
- Run `BACKEND_PORT=8211 FRONTEND_PORT=5211 ./run-local.sh` on unused dedicated ports, with an isolated database. Compare gallery/editor/cart/auth screens at matching viewport and state. Verify warm styling, Mori, focus, panel positions, placement preview, undo/redo, movement/rotation, capture and loading/error recovery.
- Replay guest room → confirmed placement → cart → account/MFA → review. Check retries add once; room/cart state survives reload and login rotation; removal/undo rules hold; switching accounts cannot expose another arrangement; cart edits invalidate earlier approval. Test `/`, `/rooms`, `/room/:id`, legacy `?room=`, main's `?roomId=`, `?legacy`, account/reset routes and direct asset URLs.
- Recheck upstream-specific behavior: Gaussian capture after camera movement, portal-aware fitting, model-only results with accurate aggregate counts, and hosted builds without local Haussmann binaries. Server pricing and stable product IDs must survive updated catalogue metadata.
- Deploy a paired Preview from the integrated source with the existing Preview database and matching API origin. Verify frontend DOM/API build IDs, secure cookies/CSRF, cold-invocation persistence and actual email delivery. Full hosted MFA and user-approved sandbox submission are still pending from the previous release; do not mark them as already verified.
- Promote a verified frontend/backend pair only after approval and acceptance. Keep the previous production pair available for rollback; migrations must remain compatible with that rollback. Do not equate Git merge with deployment. After a permitted merge, synchronize main and rerun all tests immediately. Stop every test server and record the exact deployed commit/IDs.

## 5. Ownership and completion

Track this under William's existing **Merge account and checkout routes with the pushed 3D editor** card (`03bc6470-6a84-48d8-ba48-1df4ed0f3277`), alongside the existing shopping/deployment and ownership cards. They remain open until integration and runtime verification actually complete. Coordinate shared-file edits with the active catalogue/renderer lanes before implementation.

Success means William's current interface remains recognizable and functionally intact on current main, upstream fixes remain present, all required checks pass, and the deployed artifact—not merely a local build—matches the integrated source.
