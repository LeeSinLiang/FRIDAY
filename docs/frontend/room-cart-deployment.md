# Room, cart and Vercel release

## Implemented flow

`/` redirects to `/rooms`; `/room/:roomId` opens the guest editor. Existing query-based room and `?legacy` URLs remain available. `shared/public-rooms.json` is the gallery/deployment allowlist; the tracked empty room and licensed London skyscraper are public-ready. Their gallery images are illustrations. The skyscraper uses the existing floor arrows for its 32 prepared contexts; see [floor support](room-capture/skyscraper-glb-test.md). The renderer is lazy-loaded after selecting a room.

Catalogue selection previews furniture. Click legal floor or use **Preview a fitting position**, adjust X/Z/rotation, then **Confirm placement**. No account is required. Unmapped or unpriced products are disabled. The fixture-only product buttons remain available only in legacy editor mode.

`/cart` immediately shows sign-in/create-account for guests beside their real selections. Account routes preserve the summary. Email verification, authenticator setup, recovery acknowledgement and returning-user MFA reuse the existing account flow. Recovery acknowledgement is stored server-side and must complete before cart claim or checkout creation. `/checkout?checkout=<id>` reads a stored snapshot; refresh does not submit.

The shopping components use the existing Mori typeface and warm Atelier palette. Cart/account columns stack on narrow screens; the order summary follows the authentication form.

## Persistence and API

- `friday_shopping` is a random HttpOnly cookie independent of allauth's rotating session cookie. Only its hash is stored. Production uses Secure + SameSite=Lax. Existing layouts adopt the old scene key on first creation when safe.
- `ShoppingSession` owns a scene-storage key and optional account; `CartItem` tracks room, instance and product with independent present/selected flags. Account switching cannot resolve another account's owned shopping cookie. Claim is idempotent, does not merge historical carts and retains the stable token; ownership is checked on every request under a row lock.
- Confirmation validates the real catalogue product and pose, changes scene and cart in one transaction, and records an operation receipt. Retries reuse the operation ID. Different bodies with the same ID fail. Scene and cart revisions reject stale changes.
- Moving furniture does not change quantity. Room removal clears presence; undo restores it. Cart removal clears selection while retaining the arrangement. Re-adding requires an explicit action. Repeated products display as one line with quantity.
- Checkout is server-priced USD with the explicit FRIDAY sandbox merchant. Browser totals have no authority. Cart changes supersede draft/approved snapshots. Approval/submission locks the shopping revision before claiming the checkout. Submitting/uncertain checkouts block cart changes, and no uncertain request is automatically resubmitted.

Endpoints: `GET /api/cart/`, `POST /api/cart/confirm-placement/`, `DELETE /api/cart/items/<uuid>/`, `POST /api/cart/claim/`, `POST /api/cart/checkout/`, and `POST /api/accounts/recovery/acknowledge/`. Writes enforce CSRF, including guests. Existing scene/capture endpoints resolve the shopping identity; existing checkout detail/approve/submit endpoints remain in use.

## Deployment configuration

Two Vercel projects in `williamxu070s-projects`:

| Project | Root | Role |
| --- | --- | --- |
| `friday-hackmit` | `frontend` | Vite build, `dist`, room/model assets, API/allauth rewrites |
| `friday-hackmit-api` | `backend` | Django WSGI entrypoint, shared JSON metadata, no visual assets/private runtime files |

Both projects are configured to include source files outside their root. `.vercelignore` excludes local environments, databases, keys, runtime files and scratch data from uploads. Python function exclusions separately omit large visual assets. Hosted room and catalogue loading verified the packaged metadata successfully.

Vercel flattens the Python project root to `/var/task`. `backend/build.py` copies the room allowlist, scene fixtures, public room and declared building-floor manifest/spatial metadata and furniture metadata into generated `runtime_shared/`; `api/shared_data.py` selects that location only on Vercel. No GLB, splat or private runtime data enters that package. Reading `BASE_DIR.parent/shared` on Vercel is incorrect even when monorepo source access is enabled.

Backend variables: `DATABASE_URL`, unique `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, `DJANGO_ALLOWED_HOSTS`, fresh persistent `MFA_ENCRYPTION_KEY`, `FRONTEND_ORIGIN`, exact `CSRF_TRUSTED_ORIGINS`, SMTP settings, and optional `VISA_CREDENTIALS_JSON`. Disable local inbox/tester. Do not move the local account database or its MFA key to hosting. Inline Visa JSON uses the same credential keys as local configuration, but includes PEM text instead of filesystem paths. Sending remains disabled without valid sandbox credentials.

### Release sequence

1. Link each project from the repository root with Vercel CLI; do not upload a copy of only its subdirectory, because shared assets/metadata are required.
2. Configure Preview secrets and real SMTP. The free Neon resource `friday-preview` is connected to the API project's Preview environment. Create a separate Production resource/configuration before production release.
3. Pull Preview environment variables into a private ignored file under `.scratch/`. Apply schema/cache setup explicitly using `backend/.venv/bin/python scripts/vercel_release.py migrate --env-file .scratch/friday-preview.env`. This does not import local users.
4. Deploy the API Preview first. Verify health, cart cookie, scene save, catalogue and persistence through fresh invocations. Record its immutable URL/deployment ID.
5. Set the frontend project's `FRIDAY_API_ORIGIN` for the matching environment to the verified API deployment's HTTPS origin, then deploy. `frontend/vercel.mjs` reads it during remote configuration compilation and refuses an absent or malformed value. A CLI scratch `--local-config` was not applied by the remote monorepo build; do not use it to select the API. Do not send preview users to the production database. Deployment protection must permit the frontend rewrite to reach its backend; never expose bypass credentials in browser code.
6. Set the frontend Preview alias to the exact trusted origin, verify direct page links, assets, secure cookies, anonymous CSRF, account email delivery, MFA, cart claim and stored-result recovery. Actual sandbox submission requires explicit approval in the app.
7. Only after Preview passes, configure the separate Production database/secrets, migrate, build/deploy the matching release pair and assign production aliases. Record deployment IDs and source commit/artifact hashes. Set Production `FRIDAY_API_ORIGIN` independently; there is deliberately no default to the other environment.

See official [Django deployment](https://vercel.com/docs/frameworks/full-stack/django) and [monorepo guidance](https://vercel.com/docs/monorepos/monorepo-faq).

## Verification and remaining work

Automated tests cover atomic placement rollback, idempotent retry, CSRF, authoritative product metadata/pricing, room/cart removal and undo, signup/MFA claim, account isolation, stale checkout approval and reloadable snapshots. Existing suites retain expired/reused-code and duplicate/uncertain-submission protections.

Browser checks on the canonical local launcher at 5211/8211 used a separate `.scratch/shopping-test.sqlite3`: guest gallery/editor, explicit preview confirmation, cart count, reload persistence, sign-in with order summary, room removal/undo, and 390-pixel cart overflow. No real email or Visa request was sent.

Preview now passes hosted room loading, secure guest cookies, anonymous CSRF refusal, concurrent confirmation idempotency against Neon, authoritative pricing and persistence. Both Preview and separate Production Neon schemas are migrated with independent Django/MFA secrets; local users and MFA records were not copied. SMTP settings are installed in both environments and an encrypted provider connection/authentication passes. Inbox delivery and the full public MFA/approved-checkout journey remain unverified. No Visa request or GitHub push was made.

Deployment lessons: Vercel automatically promoted the first deployment of each new project even with an explicit Preview target; those initial artifacts were removed. The upstream author's Hobby access gate was resolved with a genuine local implementation commit under William's existing Git identity. External rewrites require explicit trailing-slash variants for Django API endpoints. Runtime JSON must be packaged beside Django, not accessed from a parent directory.

Release identity: `scripts/source_identity.py` hashes all tracked/trackable runtime sources, including uncommitted edits. Set `FRIDAY_BUILD_ID` on the backend and `VITE_FRIDAY_BUILD_ID` at frontend build time to that same value. Verify the API health response's `X-Friday-Build` header and the frontend document's `data-build` attribute before handoff. Record the deployment pair and source commit separately.

### Published release — 2026-09-20

Source commit `222311a`; runtime identity `b235edc083748083597f40a20edf259919017952b43cdd7db91908e2eea279e5`.

| Environment | Frontend deployment | API deployment |
| --- | --- | --- |
| [Production](https://friday-hackmit.vercel.app) | `dpl_44SpkYFBJXkdiPBrGZHseoojWysU` | `dpl_DwuNhMcMXafRCGPUd38R4hWztnxC` |
| [Preview](https://friday-hackmit-preview.vercel.app) | `dpl_78cnLUkH3EVfAHL5N62r6jUKPF8Z` | `dpl_Hmo3bUvPSnuoYtbc6d5Buv3HU4ga` |

Both public frontend origins pass secure guest cookies, missing-CSRF refusal, persisted scenes, two concurrent requests producing one cart selection, server pricing and unauthenticated claim rejection. Production frontend DOM and API health expose the identical source hash. Local inbox and developer Visa tester return 404 in production. The hosted browser verifies guest gallery, editor, explicit preview/confirmation, cart count, sign-in/create-account and preserved summary. Final automated run: 229 backend tests (225 passed, 4 optional skips), 138 frontend tests and TypeScript/Vite build passed; existing large-renderer warnings remain.

This is a published sandbox release, not fully signed-off transaction acceptance. Actual inbox delivery, the user's full hosted MFA flow and explicitly approved sandbox submission remain pending. Those task cards stay active. Credentials were not printed or committed; no existing local user or MFA database was uploaded. The agent did not send a real email or Visa request.

Cleanup: six superseded/blocked task-created deployments were removed; the current environment pairs and Neon data remain. Earlier builds are reproducible from the local feature commits. Local test stack and board were stopped, with no listeners remaining on 8211, 5211 or 56777; the owner's 8000/5173 stack was not touched.

### Room editor UI production refresh — 2026-09-20

PR [#72](https://github.com/LeeSinLiang/hackmit2026/pull/72) merged the room editor from the separate local `hackmit2026-fresh` checkout with the shopping routes on `main` at `2ad607710d42a437f6e024639291547b3e573212`. The new middle editor has Walk controls, the floor map, and the furniture panel. The existing Rooms, Cart, account and checkout pages remain; **Search purchasable catalogue** opens the live search and retains explicit cart confirmation. The six sample sofa concepts are room previews, not purchasable listings. A local browser's saved sofa arrangement is user data and was not copied into production.

| Environment | Frontend deployment | API deployment | Runtime source identity |
| --- | --- | --- | --- |
| [Production](https://friday-hackmit.vercel.app/room/empty-room) | `dpl_JBwFo3EX9fTzQkVaGYmSfPTugDkM` | `dpl_Bn11auHniy4fUNNcLX9sNUmDnnsa` | `ba13129eb7ab69ae709894fc7653f284c3ebe4e91c95785b54abe6da8222fa1a` |

Both deployments reported `READY`. The API alias and the frontend `/api/health` rewrite returned HTTP 200 with this identity in `X-Friday-Build`; the hosted frontend DOM `data-build` matched. A hosted browser showed Rooms/Cart, Walk, floor map, the sample sofa panel, and a live HERRÅKRA catalogue result. The in-app browser denied pointer capture, so locked mouse movement was not verified in that browser. The fresh post-merge `main` tests reported `Ran 254 tests in 8.452s / OK (skipped=5)`, frontend `tests 142 / pass 142 / fail 0` plus auth `tests 16 / pass 16 / fail 0`, and Vite `built in 2.61s`. The existing missing licensed-room and large renderer warnings still apply.

### Connect GitHub to the existing Vercel projects

The GitHub CI workflow at `.github/workflows/ci.yml` runs backend tests and frontend tests/build on pull requests. It is separate from deployment. On this release, both Vercel projects reported `gitRepository: null`, and `vercel git connect https://github.com/LeeSinLiang/hackmit2026 --scope williamxu070s-projects --yes` failed for each with `Failed to connect LeeSinLiang/hackmit2026 to project`. The signed-in GitHub account has write access, but lacks admin access to this private personal repository. Issue [#74](https://github.com/LeeSinLiang/hackmit2026/issues/74) tracks the remaining owner action.

The repository owner should authorize the Vercel GitHub app for `LeeSinLiang/hackmit2026` and connect **both existing projects** in Vercel's Git settings (they may need access to the `williamxu070s-projects` Vercel team). Keep `friday-hackmit` rooted at `frontend`, `friday-hackmit-api` rooted at `backend`, and choose `main` as the Production Branch. Check a pull request's Preview deployments, then verify a merge to `main` creates new Ready Production deployments on those same projects. Keep Preview and Production databases and secrets separate. Production `FRIDAY_API_ORIGIN` now points at the stable `https://friday-hackmit-api.vercel.app` alias so a future API deployment does not leave frontend rewrites on an old immutable deployment. The current `VITE_FRIDAY_BUILD_ID` is a release-specific value; update or automate that identity for later Git-triggered builds before using it as proof of future source freshness. Until the Git binding and trigger replay succeed, merging to GitHub does not update Vercel automatically.

### Minimized furniture panel production refresh — 2026-09-20

PR [#79](https://github.com/LeeSinLiang/hackmit2026/pull/79) merged the persistent chevron into `main` at `9701b1bceb58b9977c5c51925fc5533e036a34fb`. The room editor starts with its furniture panel minimized and no Add furniture button. The right-edge chevron expands and collapses the panel; collapse retains catalogue category, favorites and scroll position. The existing Rooms, Cart, inspector and live catalogue paths remain.

| Environment | Frontend deployment | API deployment | Runtime source identity |
| --- | --- | --- | --- |
| [Production](https://friday-hackmit.vercel.app/room/empty-room) | `dpl_6qmdKhcAwomkFpFAXEy4RQ75KfHk` | `dpl_6JkuqjxPqM4JGLkPRUmP8fjDChAw` | `90d3b365dcc71c8844fb2514a3fbbdfb17c5733077b667d69f9ced1a948e7109` |

Both deployments reported `READY`. The public room route showed the collapsed edge chevron, no Add furniture button, and Rooms/Cart; clicking the chevron opened the sofa catalogue and clicking again restored the compact view. The frontend DOM `data-build`, direct API `X-Friday-Build`, and frontend `/api/health` rewrite all matched the fresh `main` source identity; both health routes returned HTTP 200. The post-merge checks reported `Ran 263 tests in 8.829s / OK (skipped=5)`, frontend `tests 142 / pass 142 / fail 0`, auth `tests 16 / pass 16 / fail 0`, board `tests 6 / pass 6 / fail 0`, and Vite `built in 2.47s`. The canonical local browser also verified keyboard Enter, hidden-panel `aria-hidden`/`inert`, retained category/favorite and live search. Narrow breakpoint CSS was reviewed without a resized browser replay. The Git connection blocker in issue #74 still applies to future merges.
