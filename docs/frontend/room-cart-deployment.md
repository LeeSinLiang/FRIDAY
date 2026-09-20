# Room, cart and Vercel release

## Implemented flow

`/` redirects to `/rooms`; `/room/:roomId` opens the guest editor. Existing query-based room and `?legacy` URLs remain available. `shared/public-rooms.json` is the gallery/deployment allowlist; the tracked empty room and licensed London skyscraper are public-ready. Their gallery images are illustrations. The skyscraper uses the existing floor arrows for the entrance lobby, mezzanine and 32 tower floor contexts; see [floor support](room-capture/skyscraper-glb-test.md). The renderer is lazy-loaded after selecting a room.

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

### Category rail and gravity release — 2026-09-20

PR [#83](https://github.com/LeeSinLiang/hackmit2026/pull/83) replaced the lone collapsed tab with a slim rounded category rail and circular chevron; choosing a category expands its content. PR [#84](https://github.com/LeeSinLiang/hackmit2026/pull/84) added Space jumping, gravity, and standing or walking on the dimensioned tops of placed furniture. PR [#85](https://github.com/LeeSinLiang/hackmit2026/pull/85) added an input-level PlayCanvas test that jumps onto a sofa, stays on top, then walks off and falls. The latest source commit is `68367e8c1efd879e627f7c585dabac1a0876d6a9`.

| Environment | Frontend deployment | API deployment | Runtime source identity |
| --- | --- | --- | --- |
| [Production room](https://friday-hackmit.vercel.app/room/empty-room) | `dpl_6YBeLyktFyhg6YeBcbzEvkxGiP9Z` | `dpl_8KMxQysWYwH5cn9pCVahQdp9vBgG` | `c0de19855603d17b57abc20f8a5ef70fac7743e066171e2d4575d1e361a6f383` |

Both deployments reported `READY`. Direct API health and the frontend rewrite returned HTTP 200 with the same `X-Friday-Build` as the hosted frontend `data-build`. The public room loaded with Rooms/Cart, the compact category rail, and the Space hint. Hosted browser checks opened Chairs from the rail, saw the camera rise during Space and return under gravity, and preserved the visible room controls. Fresh `main` after #85 reported `Ran 263 tests in 8.347s / OK (skipped=5)`, frontend `tests 147 / pass 147 / fail 0`, auth `tests 16 / pass 16 / fail 0`, and Vite `built in 2.56s`. The sofa-top route is backed by an input-level PlayCanvas event/frame test; a full browser furniture-placement-and-landing replay was not completed. Product dimensions define conservative solid boxes rather than exact cushion mesh collision, and fixed scanned obstacles remain full-height blockers because their heights are not recorded. The Git connection blocker in issue #74 still applies to future merges.

### Latest combined main production refresh — 2026-09-20

The teammate's [skyscraper-room PR #86](https://github.com/LeeSinLiang/hackmit2026/pull/86) merged while the release record was in CI, changing runnable frontend and backend sources. The pair below refreshes production from the resulting `main` commit `e2ae0a80575b7f370e21318cba30d3597bfa3edf` rather than leaving the earlier rail/jump artifact as the active release.

| Environment | Frontend deployment | API deployment | Runtime source identity |
| --- | --- | --- | --- |
| [Production room](https://friday-hackmit.vercel.app/room/empty-room) | `dpl_4HpXref96fRAM8KVdoWx7JMbATAR` | `dpl_AvfZTu6JmRbtUkUPz1N8XAQ2DU35` | `c0b5858f4ea335ca209a4040d6ec1cb957605ac5434fa2199971ad9b7616f19c` |

Both deployments reported `READY`. Direct and rewritten API health returned HTTP 200 with the same `X-Friday-Build` as the hosted frontend `data-build`. The public empty-room route loaded with Rooms/Cart and the compact category rail; choosing Chairs opened the category, and Space raised the camera while gravity returned it to floor height. The full suite on fresh combined `main` reported `Ran 267 tests in 9.602s / OK (skipped=5)`, frontend `tests 152 / pass 152 / fail 0`, auth `tests 18 / pass 18 / fail 0`, board `tests 6 / pass 6 / fail 0`, and Vite `built in 3.03s`. The input-level sofa-top test remains part of that passing suite; the full browser placement-and-landing limit above still applies. Git-triggered Vercel deployment remains blocked by issue #74.

### Entrance lobby and real room previews — 2026-09-20

The corrected lobby, mezzanine, 32 tower floor metadata and current editor UI are on merged `main` at `9adbf97`. The frontend release was built manually from the checkout serving port 5173, feature branch `codex/room-release-from-5173` at pushed commit `85f3279`. It adds actual renderer screenshots for the three gallery cards. The matching API was built from merged-main runtime sources.

| Environment | Frontend deployment | API deployment | Runtime source identity |
| --- | --- | --- | --- |
| [Production rooms](https://friday-hackmit.vercel.app/rooms) | `dpl_Ah54qmfa7SriM8VvJrYgUQMn3GUn` | `dpl_3Q5aTaKrdvJQ4HfCEqL5WZJynh4f` | `96c81e343127e74219a3223af6d33e56a3753961499b5ceec6897f849ab72d64` |

`vercel inspect` reported the frontend `READY`. Direct and rewritten `/api/health/` returned HTTP 200 with the identity above in `X-Friday-Build`; the live frontend `data-build` matched. The public browser showed screenshot cards and loaded the actual entrance, mezzanine and first tower floor as Floors 1, 2 and 3 of 34. The lobby floor plan showed its full irregular footprint. In the 5173 checkout, `manage.py test` ran 281 tests with `OK (skipped=4)`, `npm test` passed 181 scene and 25 account tests, the Vite build finished in 4.30 seconds, and board tests passed 6. The public Cg Arch card displays its captured preview but cannot be opened: its Blendkit licensed GLB is kept local and excluded from Vercel. This manual release does not resolve Git-triggered deployment issue #74. A fresh small off-centre public placement boundary replay remains open on the skyscraper task.


## Scene designer test release — 2026-09-20

PR #103 (`5afe392`) is published as the matching pair recorded in [public test release](../demo/public-test-release.md). The live source identity is `778d7e434fa26ce392a6a4179af5ed496bac83053f345e6cd119173e9664b1bd`. Hosted AI support placement, manual parent movement/rotation and undo/redo passed; the original test floor was restored. The later lighting merge `46930f6` is not included in this deployed snapshot.

## Haussmann public room replacement — 2026-09-20

PR [#114](https://github.com/LeeSinLiang/hackmit2026/pull/114) merged at `0e7e7c6`, replacing the unavailable public Cg Arch gallery card with the CC BY Haussmann apartment. The main commit advanced to `3f842fb` through a documentation-only merge and retained the same runtime source identity, `1ff59315b695d95c2f0582df91af8f7c59beb5d912e32b801db8e5b93ecc14ac`.

| Environment | Frontend deployment | API deployment | Runtime source identity |
| --- | --- | --- | --- |
| [Production Haussmann room](https://friday-hackmit.vercel.app/room/haussmann-apartment) | `dpl_7pebQ1buMCAyefRMLb5PHzhDuQhE` | `dpl_3hNCVy83CMJaQoKfWZKcsyvkutSR` | `1ff59315b695d95c2f0582df91af8f7c59beb5d912e32b801db8e5b93ecc14ac` |

Both deployments reported `READY`. The frontend `data-build`, direct API and rewritten API `X-Friday-Build` matched. Public asset HEAD requests returned 200 for the 43,111,562-byte SOG, 4,867,408-byte collision GLB and 71,628-byte gallery preview; the London GLB remained HTTP 200. In the public browser, `/rooms` offered the Haussmann apartment without an unavailable label and `/room/haussmann-apartment` rendered its empty parquet room with Stéphane Agullo/CC BY credit. The isolated local browser also saved a HERRÅKRA chair, showed it on the floor plan and incremented the cart. Screenshots are in `.scratch/haussmann-production-{gallery,room}.png` in the merged verification checkout. Fresh merged-main checks reported `Ran 393 tests in 14.320s / OK (skipped=5)`, 209 scene and 25 packaging/auth frontend tests passed, and Vercel-mode `npm run build` finished in 3.82 seconds. Scale remains assumed; the manifest labels it `synthetic_demo`. Automatic GitHub-to-Vercel deployment remains issue #74, so this was a manual production release.
