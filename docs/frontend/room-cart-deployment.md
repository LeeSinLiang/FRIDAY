# Room, cart and Vercel release

## Implemented flow

`/` redirects to `/rooms`; `/room/:roomId` opens the guest editor. Existing query-based room and `?legacy` URLs remain available. `shared/public-rooms.json` is the gallery/deployment allowlist; only the tracked empty room is currently public-ready. Its gallery image is an illustration. The renderer is lazy-loaded after selecting a room.

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

Both projects are configured to include source files outside their root. `.vercelignore` excludes local environments, databases, keys, runtime files and scratch data from uploads. Python function exclusions separately omit large visual assets. Hosted packaging remains to be verified before release.

Backend variables: `DATABASE_URL`, unique `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, `DJANGO_ALLOWED_HOSTS`, fresh persistent `MFA_ENCRYPTION_KEY`, `FRONTEND_ORIGIN`, exact `CSRF_TRUSTED_ORIGINS`, SMTP settings, and optional `VISA_CREDENTIALS_JSON`. Disable local inbox/tester. Do not move the local account database or its MFA key to hosting. Inline Visa JSON uses the same credential keys as local configuration, but includes PEM text instead of filesystem paths. Sending remains disabled without valid sandbox credentials.

### Release sequence

1. Link each project from the repository root with Vercel CLI; do not upload a copy of only its subdirectory, because shared assets/metadata are required.
2. Configure Preview secrets and real SMTP. The free Neon resource `friday-preview` is connected to the API project's Preview environment. Create a separate Production resource/configuration before production release.
3. Pull Preview environment variables into a private ignored file under `.scratch/`. Apply schema/cache setup explicitly using `backend/.venv/bin/python scripts/vercel_release.py migrate --env-file .scratch/friday-preview.env`. This does not import local users.
4. Deploy the API Preview first. Verify health, cart cookie, scene save, catalogue and persistence through fresh invocations. Record its immutable URL/deployment ID.
5. Generate a paired frontend config with `scripts/vercel_release.py frontend-config --backend-origin https://<verified-api-deployment> --output .scratch/frontend.preview.json`. Use that config via the Vercel CLI's `--local-config` for the matching frontend deployment. Do not send preview users to the production database. Deployment protection must permit the frontend rewrite to reach its backend; never expose bypass credentials in browser code.
6. Set the frontend Preview alias to the exact trusted origin, verify direct page links, assets, secure cookies, anonymous CSRF, account email delivery, MFA, cart claim and stored-result recovery. Actual sandbox submission requires explicit approval in the app.
7. Only after Preview passes, configure the separate Production database/secrets, migrate, build/deploy the matching release pair and assign production aliases. Record deployment IDs and source commit/artifact hashes. `frontend/vercel.json`'s default rewrite targets the intended production API alias, not an already verified live deployment.

See official [Django deployment](https://vercel.com/docs/frameworks/full-stack/django) and [monorepo guidance](https://vercel.com/docs/monorepos/monorepo-faq).

## Verification and remaining work

Automated tests cover atomic placement rollback, idempotent retry, CSRF, authoritative product metadata/pricing, room/cart removal and undo, signup/MFA claim, account isolation, stale checkout approval and reloadable snapshots. Existing suites retain expired/reused-code and duplicate/uncertain-submission protections.

Browser checks on the canonical local launcher at 5211/8211 used a separate `.scratch/shopping-test.sqlite3`: guest gallery/editor, explicit preview confirmation, cart count, reload persistence, sign-in with order summary, room removal/undo, and 390-pixel cart overflow. No real email or Visa request was sent.

At this checkpoint deployment is **incomplete**: the projects and Neon Preview resource exist, Preview security/SMTP/Visa settings are populated from the documented private Visa/auth worktree, and hosted schema/cache migrations pass. No local users or MFA records were copied. The initial CLI deployment unexpectedly targeted Production and was removed; use explicit `--target=preview`, including on a new project. The subsequent Preview was blocked by Vercel because the repository's latest upstream commit belonged to a teammate not authorized on this Hobby project. A new genuine implementation commit under the existing William Git identity is being prepared; no author metadata is forged and no GitHub push is authorized. PostgreSQL concurrency, hosted packaging/proxying, real email delivery and the full public account/checkout journey remain release gates. Production has no database yet.

Release identity: `scripts/source_identity.py` hashes all tracked/trackable runtime sources, including uncommitted edits. Set `FRIDAY_BUILD_ID` on the backend and `VITE_FRIDAY_BUILD_ID` at frontend build time to that same value. Verify the API health response's `X-Friday-Build` header and the frontend document's `data-build` attribute before handoff. Record the deployment pair and source commit separately.
