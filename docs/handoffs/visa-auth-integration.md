# Visa/auth integration handoff

Owner: William. Branch: `codex/visa-sandbox`. Updated: 2026-09-19.

## Baseline and teammates' work

This branch incorporates `origin/main` through [`98ca88d`](https://github.com/LeeSinLiang/hackmit2026/commit/98ca88d). It includes the catalogue/compiler merge from [PR #11](https://github.com/LeeSinLiang/hackmit2026/pull/11), the room-editor merge `3cf1463`, and the first-person Gaussian-splatting research/pivot notes. The latter document planned work; they are not proof of an implemented splat renderer.

The committed `data/board.json` is a snapshot of the user's current **FRIDAY · Project Plan**, with the six existing components, IDs, task ownership and ordering preserved. Board implementation files remain exactly as they appear in this main baseline. The owner-coloured board UI is on the separate `codex/fix-kanban-controls` branch; the shared data snapshot does not claim that UI has been merged here.

At this reconciliation, `codex/saketh-wall-exceptions` (`11cb6aa`) was separately pushed but not in main. Its wall-exception changes are not included here. The other checkout's uncommitted asset-browser work is also outside this branch.

## What this branch adds

**Scope boundary:** William requested that teammates' code and the existing Visa HTML tester remain unchanged. The editor integration and catalogue-test edits tried during reconciliation were removed. Account components are provided for the UI owner to integrate using the steps below; they are not currently mounted by the new editor.

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
2. **Bridge catalogue and scene units/IDs.** The editor's `Product` has `productId`, `name`, and dimensions in centimetres. Catalogue dimensions are millimetres: divide by ten at the adapter boundary. Persist stable product IDs so placed and unplaced cart items refer to the same authoritative listing. The root editor's test furniture is not automatically a checkout cart.
3. **Define guest-room and account ownership.** `backend/api/scene_views.py` and `scene_service.py` address scenes by Django session key. Authentication can rotate or replace that key. No transfer from a guest scene to an account is implemented or verified here; decide the transfer/ownership policy before claiming a room survives a first login, logout, or account switch.
4. **Finish the broader agent/spatial journey.** Compiler/search endpoints and scene tool adapters are available. Full agent orchestration, the complete valid-space overlay, and catalogue-to-checkout wiring remain separate work. Keep their broad board cards open despite completed foundation tasks.
5. **Payment and ordering remain separate.** An IDX Match Key is accepted transaction context, not a card authorization, purchase, or vendor order. No final transaction was performed. Production hosting, HTTPS, production database/cache, provider configuration, and font licensing remain subject to their existing feature documentation.
6. **Resolve cache/test compatibility with the catalogue owner.** Our account settings use Django `DatabaseCache` for persistent rate limits and used-TOTP markers. Five existing `CompileEndpointTests(SimpleTestCase)` call `cache.clear()` and fail because that test class forbids database access. A database-aware test case or an explicitly isolated cache override is an owner decision. Do not disable production replay/rate-limit protections to hide the test failure. The attempted test-class edit was reverted at William's request.

## Verification

After both upstream pulls and dependency reconciliation:

- Canonical `./setup.sh` passed, applied the three scene/capture migrations, and preserved the existing auth key and account database.
- Final combined backend run: **153 tests, 5 failures, 1 optional live test skipped**. All five failures are the cache/test incompatibility above; all other tests passed. An earlier exploratory run passed after editing those five tests, but that edit was removed and is not the final branch result. Migration drift check: no changes.
- The scoped `visa accounts checkout` suite passed all **36 tests** independently.
- Frontend: **27 scene tests and 9 auth/API/routing tests passed**. TypeScript/Vite production build passed; the existing large Three.js furniture chunk warning remains.
- Refreshed this worktree using `./run-local.sh` on **5174/8001**. The independent **5173/8000** checkout was preserved. Chrome loaded the unchanged HTML tester with X-Pay/MLE readiness and a source hash matching the local Visa implementation, then validated a new sample locally without sending it to Visa. Auth user/email/authenticator rows and the MFA encryption key matched the pre-pull fingerprints.
- Account → editor navigation was checked during an exploratory integration, then removed in accordance with the final scope. That check is not proof of mounted account routes on this branch. The board-code reconciliation was likewise removed; its exploratory tests do not describe code shipped here.

The earlier real Gmail delivery, phone-generated FRIDAY code, and Visa IDX response are recorded in [TODO_WILLIAM.md](../../TODO_WILLIAM.md) and the sanitized [checkout receipt](../evidence/account-checkout-2026-09-19.json). The current integration checks do not resend email or Visa requests. Automated Visa transport is mocked; Elasticsearch/OpenAI live services are not qualified by this test run.

Reproduce from the repository root:

```bash
./setup.sh
(cd backend && uv run python manage.py test visa accounts checkout)
# The combined suite currently reproduces the five documented cache/test failures:
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
git push -u origin codex/visa-sandbox
```

Open a pull request from `codex/visa-sandbox` into `main` to share the integrated work for review. Never push directly to main or force-push over another contributor. Before another upstream update, preserve local edits and reconcile new changes; `git pull --ff-only` is appropriate only when the chosen branch can actually fast-forward.

Run `node .github/extensions/project-manager/bin.mjs` to open this checkout's committed board snapshot. The user's existing owner-coloured board continues to run from the separate main checkout and its existing branch code. Other machines get the plan snapshot by pulling Git; they do not share this local live file. Stop board writers before Git/manual board updates and restart at the newly printed URL. See the [board guide](../../.github/extensions/project-manager/README.md). Owner-coloured rendering itself still requires the separate board-controls branch.

Two local recovery stashes preserve the work before the pulls (`3a3751a`, `69efdb4`). They are backup checkpoints, not outstanding work to apply again, and are not transferred by pushing the branch.
