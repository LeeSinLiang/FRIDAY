# Visa/auth integration handoff

Owner: William. Branch: `codex/visa-cache-compatibility`. Updated: 2026-09-20.

Review: [PR #21 — Add Visa IDX and account MFA with isolated catalogue cache tests](https://github.com/LeeSinLiang/hackmit2026/pull/21), from `codex/visa-cache-compatibility` into `main`, replaces [PR #19](https://github.com/LeeSinLiang/hackmit2026/pull/19). It retains the original implementation and resolves the reported P1 cache/test regression tracked in [issue #20](https://github.com/LeeSinLiang/hackmit2026/issues/20). Review and merge remain pending.

## Baseline and teammates' work

This branch incorporates `origin/main` through [`be795d8`](https://github.com/LeeSinLiang/hackmit2026/commit/be795d830acc7b67740f8ab9385db2444eaff33d). It includes the earlier catalogue/editor and region-solver work, catalogue products placeable in scenes from PR #18, and the compile cache test and throttle changes from PRs #22 and #24. The Gaussian-splatting research notes still describe planned work rather than an implemented splat renderer. Main was merged into this feature branch; that does not merge the Visa/auth branch into main.

The committed `data/board.json` is a snapshot of the user's current **FRIDAY · Project Plan**, with the six existing components, IDs, task ownership and ordering preserved. The PR includes the compatible owner-coloured standalone UI and canvas adapter, combined with the main baseline's atomic transactions, locking and live polling/SSE. Historical phase metadata is retained, including the three new upstream catalogue tasks marked `mvp`; component identities and task order are not regenerated. This resolves the P2 board review in issue #23.

The previously separate `codex/saketh-wall-exceptions` work is now included through main. The other checkout's uncommitted asset-browser work remains outside this branch.

## What this branch adds

**Scope boundary:** The existing Visa HTML tester remains unchanged. The P1 correction is a class-scoped cache override and cleanup in `backend/catalogue/test_compile.py`; the P2 correction ships matching owner-aware board code with the snapshot. The current editor and compile throttle changes come from upstream main; application authentication/cache settings are unchanged by this reconciliation. Account components are provided for the UI owner to integrate using the steps below; they are not currently mounted by the editor.

| Area | Current behaviour and source |
| --- | --- |
| Account and MFA | `backend/accounts/`, `frontend/src/auth/`: signup, mandatory email codes, password reset, TOTP enrollment/login, recovery codes, and security settings. Fixes pending-verification navigation and clarifies the password-before-QR setup step. |
| Mail and storage | Browser-scoped local inbox by default; SMTP configurable. This machine's existing Gmail setup is private. SQLite stores hashed passwords and encrypted MFA records; setup preserves the private key. |
| Visa | `backend/visa/`: strict sandbox payload validation, X-Pay signing, MLE encryption/decryption, sanitized results, and the separate HTML developer tester. |
| Checkout | `backend/checkout/`, `frontend/src/checkout/`: server-priced fixture cart, immutable snapshot, explicit consent and fresh TOTP, single-use approval, one submission claim, stored IDX result. |
| Editor handoff | `frontend/src/auth/` and `frontend/src/checkout/` contain the existing account UI for integration. `frontend/src/App.tsx` and `frontend/vite.config.ts` are unchanged from main. |
| API configuration | Additive registration in `backend/config/`, dependency lockfiles, setup and launcher makes the Visa/account/checkout backend available alongside existing catalogue and scene routes. |
| Project Plan | Updated board data, documentation and William's work log record completed work and remaining integration tasks. Board implementation and teammates' tests are unchanged. |

Read the existing [catalogue contract](../backend/catalogue.md), [editor handoff](../frontend/editor-implementation.md), [scene API](../backend/contracts/scene-api.md), [account workflow](../account-mfa-checkout.md), and [Visa tester](../visa-sandbox.md) together. This handoff complements those feature docs.

## Keep the HTML tester as the reference

`backend/visa/templates/visa/sandbox_test.html` is byte-for-byte identical to the pre-pull checkpoint (SHA-256 `ed0e0e1b7b9491a88e531a22f95efb46037968174e1851b267be59d10a52e9db`). Open **http://127.0.0.1:8001/api/visa/sandbox-test/** in this worktree, or the backend port printed by `./run-local.sh` elsewhere. Enable `VISA_SANDBOX_TESTER_ENABLED` and configure the private credential-file path in `.env` as documented in the Visa guide.

Its sequence is New sample → Validate locally → review the stored snapshot → explicit approval → Send to Visa sandbox → inspect sanitized evidence. Validation writes the sample to the local server and does not send it to Visa. The HTML page remains a separate loopback-only developer harness; its text correctly says account MFA is not a feature of that tester. The account/MFA APIs are a separate implementation.

For the customer-facing UI, use the authenticated checkout APIs below rather than copying the developer submission endpoint into the editor. Keep secrets, X-Pay generation, MLE, pricing and approval checks on Django.

## UI integration instructions for the next owner

These changes are proposed, **not applied to the teammate's editor**:

1. Mount `frontend/src/auth/AccountApp.tsx` for `/account`, `/account/sign-in`, `/account/create`, `/account/security`, password-reset routes and `/checkout`. Keep the existing room-editor hooks in a separate component if using a pathname wrapper, so switching routes cannot change hook order. Add agreed navigation to Account/Checkout and back to the editor.
2. Add a Vite proxy for `/_allauth` to the configured backend port with `changeOrigin: false`, matching the existing `/api` proxy's Host-preserving CSRF behaviour. Production hosting must route both prefixes to Django and serve the SPA for account/reset deep links. No new browser-side Visa credential configuration is needed.
3. Retain `AuthProvider` and the state transitions in `auth/flow.ts`: new account → email verification → password confirmation → QR → successful TOTP activation → recovery-code acknowledgement; returning account → password → authenticator/recovery challenge. Preserve the reset/logout pending-session cleanup. Route hiding alone does not authorize checkout; Django enforces it.
4. Adapt the new cart to these routes, using session cookies, CSRF and the existing API wrapper:

   | Request | Purpose |
   | --- | --- |
   | `GET /api/accounts/status/` | Determine verified-email/MFA readiness. |
   | `GET /api/checkouts/catalogue/` | Inspect the current fixture catalogue; replace only after agreeing the authoritative catalogue contract. |
   | `POST /api/checkouts/` with `items: [{product_id, quantity}]` | Obtain the server-priced immutable review snapshot and hash. |
   | `POST /api/checkouts/{id}/approve/` with `snapshot_hash`, `approved: true`, `code` | Explicitly approve that snapshot with a fresh authenticator code. |
   | `POST /api/checkouts/{id}/submit/` with `snapshot_hash` | Consume that approval and attempt one IDX submission. |
   | `GET /api/checkouts/{id}/` | Reload the owner's saved result without resubmitting. |

5. Display the returned Match Key and IDX status as data-exchange results. Cart changes require a new snapshot and approval. Keep uncertain outcomes visible; do not automatically retry the submission.
6. Replay signup, verification, password reset, first QR enrollment, returning MFA login, recovery, expired/used codes, cart tampering, duplicate submission, and a deliberate sandbox approval through the new UI. Check room ownership through login before claiming an end-to-end shopping journey.

## Remaining integration contracts

1. **Connect the real cart to checkout.** `backend/checkout/catalogue.py` still contains only `sample-sofa` (42500 cents) and `sample-lamp` (7900 cents), a fixture vendor, and USD. The catalogue's `Listing` uses `id`, `title`, `price_cents`, `dims_mm`, `source`, and `model_url`; it does not yet provide an agreed checkout currency, merchant identity or stock contract. A catalogue source label is not a verified merchant. Agree these fields before replacing the fixture adapter. Resolve submitted product IDs and prices on the server, then create the existing immutable checkout snapshot; retain explicit approval and fresh MFA.
2. **Bridge catalogue and scene units/IDs.** The new `frontend/src/region/boundary.ts` already supplies `mmToCm`, `listingToProduct`, clause conversion and wall mapping; reuse it. The editor's `Product` uses centimetres while catalogue dimensions are millimetres. Scene persistence still accepts the fixture product IDs, so a converted catalogue listing is not yet a persistable room item. Persist stable product IDs so placed and unplaced cart items refer to the same authoritative listing. The root editor's test furniture is not automatically a checkout cart.
3. **Define guest-room and account ownership.** `backend/api/scene_views.py` and `scene_service.py` address scenes by Django session key. Authentication can rotate or replace that key. No transfer from a guest scene to an account is implemented or verified here; decide the transfer/ownership policy before claiming a room survives a first login, logout, or account switch.
4. **Finish the broader agent/spatial journey.** Compiler/search endpoints, scene tool adapters and the [region solver](../frontend/region-solver.md) are available. The solver handles placement clauses and optional opening/occupancy inputs with masks and rejection explanations. Rendering its overlay in the editor, making real catalogue products persistable, full agent orchestration and catalogue-to-checkout wiring remain separate work. Keep broad integration cards open despite completed foundations.
5. **Payment and ordering remain separate.** An IDX Match Key is accepted transaction context, not a card authorization, purchase, or vendor order. No final transaction was performed. Production hosting, HTTPS, production database/cache, provider configuration, and font licensing remain subject to their existing feature documentation.

## Verification

P2 board correction: the canonical launch was reproduced and repaired in Chrome before this sync. All six board regression tests still pass, including legacy-phase preservation, owner HTTP controls and concurrent/SSE writes. The merged snapshot keeps all 48 PR cards, all five upstream cards and their phase values. The PR worktree's canonical board command served its six components and owner controls on a temporary port, then was stopped. The board source files in the main checkout are byte-identical to this branch; its separate board data remains there. Copilot's host itself was not available for verification; the adapter uses the shared model/server.

Current reconciliation, on main baseline `be795d8`:

- Canonical `./setup.sh` passed with no new migrations and preserved the existing MFA key. Migration drift, board syntax and whitespace checks passed.
- The documented combined backend command ran **169 tests: 168 passed, one optional live-model test skipped**. The existing endpoint tests retain their assertions, including the `200, 200, 429` throttle check. The upstream unreachable-cache test also passes. Their dedicated `LocMemCache` is cleared before/after each test; unittest class cleanup restores the application `DatabaseCache`. Auth and checkout tests still use that persistent cache.
- The scoped `visa accounts checkout` suite previously passed all **36 tests** independently, and these tests pass within the current combined run.
- **57 scene/region and 9 auth/API/routing frontend tests** passed. TypeScript/Vite production build passed; the existing large Three.js furniture chunk warning remains.
- Refreshed this worktree using the canonical `./run-local.sh` on **5174/8001** and preserved the independent checkout's services. The frontend route and backend health/search endpoints respond; search reports 12,040 listings. The unchanged HTML tester bootstrap reports the current worktree path and source hash `dbb448fea881aab1fee800168e37ad86d027237f0ca2e420a4bd9e73e01042b8`, matching local source. No email or Visa submission was sent. Tests use a disposable test database; existing accounts, MFA keys and SMTP settings were preserved.
- Account → editor navigation was checked during an exploratory integration, then removed in accordance with the final scope. That check is not proof of mounted account routes on this branch. The earlier exploratory board reconciliation was removed at that time; the later P2 correction now includes the compatible board implementation and its own verification.

The earlier real Gmail delivery, phone-generated FRIDAY code, and Visa IDX response are recorded in [TODO_WILLIAM.md](../../TODO_WILLIAM.md) and the sanitized [checkout receipt](../evidence/account-checkout-2026-09-19.json). The current integration checks do not resend email or Visa requests. Automated Visa transport is mocked; Elasticsearch/OpenAI live services are not qualified by this test run.

Reproduce from the repository root:

```bash
./setup.sh
(cd backend && uv run python manage.py test visa accounts checkout)
# Combined regression suite; the former five cache failures are resolved:
(cd backend && OPENAI_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test api catalogue visa accounts checkout)
(cd backend && uv run python manage.py makemigrations --check --dry-run)
(cd frontend && npm test)
(cd frontend && node --experimental-strip-types --test src/auth/api.test.mjs src/auth/flow.test.mjs)
(cd frontend && npm run build)
./run-local.sh
```

Use the printed frontend URL for the unchanged room editor and the backend URL `/api/visa/sandbox-test/` for the preserved HTML tester. `/account` and `/checkout` require the UI integration above; the current editor does not mount them. New clones use their own SQLite database and private encryption key. Configure SMTP/Visa credentials privately; Git does not transfer William's accounts, sessions, mail credentials or Visa keys.

## Branch sharing and Project Plan

Code, configuration templates, feature documentation, INDEX, William's work log, and the board snapshot belong in the same feature branch. Do not replace teammates' docs or mark unrelated integrations complete. Historic TODO entries describe their state at the time; this handoff records the combined baseline.

For subsequent changes, inspect and stage the intended files, review `git diff --cached`, then use an imperative commit subject plus a detailed body covering all staged changes and actual verification. Push this branch:

```bash
git status --short --branch
git diff --check
git diff --cached
# After staging and committing the reviewed changes:
git push -u origin codex/visa-cache-compatibility
```

Use [PR #21](https://github.com/LeeSinLiang/hackmit2026/pull/21), from `codex/visa-cache-compatibility` into `main`, for review of the integrated work. Never push directly to main or force-push over another contributor. Before another upstream update, preserve local edits and reconcile new changes; `git pull --ff-only` is appropriate only when the chosen branch can actually fast-forward.

Run `node .github/extensions/project-manager/bin.mjs` to open this checkout's committed board snapshot. The user's canonical launch path in the main checkout has been refreshed with the exact board source from this PR. Other machines get the plan snapshot by pulling Git; they do not share this local live file. Stop board writers before Git/manual board updates and restart at the newly printed URL. See the [board guide](../../.github/extensions/project-manager/README.md). Owner-coloured rendering is included in this PR.

Two local recovery stashes preserve the work before the pulls (`3a3751a`, `69efdb4`). They are backup checkpoints, not outstanding work to apply again, and are not transferred by pushing the branch.
