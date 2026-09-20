# FRIDAY · HackMIT 2026

Django REST Framework API + React/TypeScript/Vite frontend with Three.js through React Three Fiber.

## Local setup

Requires macOS/Linux (or WSL), Node.js 22.12+ with npm, and internet access for initial installation.

```bash
./setup.sh
./run-local.sh
```

`setup.sh` checks Node/npm, installs uv if missing using Astral's official installer, creates `.env` only if absent, syncs the Python 3.12 environment, runs Django migrations/checks, creates the shared local cache table and a private MFA encryption key if absent, and installs frontend dependencies. uv can download Python if needed. Rerun setup after dependency or migration changes; existing `.env` and database data are preserved. Keep the generated lockfiles in Git for reproducible installs.

- Frontend: http://127.0.0.1:5173
- API health: http://127.0.0.1:8000/api/health/
- Django admin: http://127.0.0.1:8000/admin/

Both servers reload on edits. Ctrl-C stops both, including reload workers. Occupied ports fail with a clear error; edit `BACKEND_PORT` / `FRONTEND_PORT` in `.env` to use other ports. Shell environment variables take precedence. These scripts run locally without Docker.

## Layout

| Path | Purpose |
| --- | --- |
| `backend/config/` | Django settings, URLs, ASGI/WSGI entry points |
| `backend/api/` | REST routes, health endpoint, API tests |
| `backend/accounts/` | Account policy, encrypted MFA adapter, private local inbox |
| `backend/checkout/` | Immutable sample checkout, MFA approval, authenticated IDX submission |
| `backend/visa/` | IDX schema, X-Pay/MLE client, separate developer tester |
| `frontend/src/auth/`, `frontend/src/checkout/` | Account, security, checkout, and receipt screens |
| `backend/pyproject.toml`, `backend/uv.lock` | Python dependencies and lockfile |
| `frontend/src/App.tsx` | Room editor; preserved from main |
| `frontend/src/Scene.tsx` | Lazy-loaded React Three Fiber room and furniture scene |
| `frontend/vite.config.ts` | Existing dev server and `/api` proxy to Django; account proxy integration is documented in the handoff |
| `frontend/package.json`, `frontend/package-lock.json` | Frontend commands, dependencies, lockfile |
| `.env.example` | Shareable local configuration template |
| `setup.sh` | Dependency setup and database migrations |
| `run-local.sh`, `scripts/run_local.py` | Full-stack dev process lifecycle |

The API uses SQLite locally. `GET /api/health/` is public and returns `{"status":"ok","service":"friday-api"}`. Other REST views require authentication by default unless explicitly overridden. Call `/api/...` from the frontend; Vite proxies these requests to Django, so no local CORS setup is needed. Production hosting must route `/api` and `/_allauth` to Django; Vite's dev proxy is not bundled into the frontend build.

The default room editor uses PlayCanvas with the prepared Cg Arch mesh when its local licensed assets are present, otherwise the included empty-room mesh. Add the shared GLB sofa through **Add furniture**. The existing Three.js catalogue and region editor remains available at `/?legacy` (including `&room=studio`). See [mesh provisioning and visual limitations](docs/frontend/room-capture/cg-arch-interior.md). Root `.env` supports `SCENE_UNIT_CM=5` (centimeters per render unit); restart Vite after changing it. Poses and dimensions remain centimeters. See the [editor implementation and handoff](docs/frontend/editor-implementation.md) for controls, model integration, verification, and current limits.

## Checks and common commands

```bash
(cd backend && uv run python manage.py check)
(cd backend && OPENAI_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test)   # every app: no labels, on purpose
(cd frontend && npm test)                                                          # every frontend test, auth included
(cd frontend && npm run build)
(cd backend && uv run python manage.py createsuperuser)
```

These three are what CI runs on every pull request (`.github/workflows/ci.yml`): no secrets, a few minutes, and advisory rather than required, so it never blocks an emergency fix. **Run the backend suite without app labels.** A label list such as `test api catalogue` silently skips every app it does not name. `npm test` is likewise the whole frontend suite: `frontend/scripts/every-test-runs.test.ts` fails if any `*.test.*` file on disk is not reachable from it.

Add backend dependencies with `cd backend && uv add <package>`; frontend dependencies with `cd frontend && npm install <package>`. Keep both lockfiles in Git. React is constrained to 19.2 because the installed React Three Fiber 9 peer range excludes React 19.3.

The local settings default to debug mode and a development-only secret. Deployment needs a real `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, allowed hosts, and a production server/static-file strategy. No Docker or deployment configuration is scaffolded yet.

The preserved Visa HTML tester is available on the backend at `/api/visa/sandbox-test/` when enabled in private local configuration. Account/MFA and checkout components are included for the new UI owner to integrate; `/account` and `/checkout` are not mounted in the current editor. Their previously tested workflow covers email verification, authenticator enrollment/login, recovery and approved sample IDX requests. Account data persists in the ignored local `backend/db.sqlite3`, with hashed passwords and encrypted MFA data. William's existing local Gmail SMTP configuration remains private; default DEBUG setups use a browser-session test inbox until SMTP is configured. See the [account/MFA workflow](docs/account-mfa-checkout.md) and [integration handoff](docs/handoffs/visa-auth-integration.md) for wiring instructions and the resolved catalogue test/cache compatibility issue. The combined backend suite passes with a cache override limited to the catalogue endpoint tests; runtime authentication continues to use the persistent database cache.

See [INDEX.md](INDEX.md) for project docs and team work logs.

For the combined catalogue/editor/account branch, read the [Visa/auth integration handoff](docs/handoffs/visa-auth-integration.md). It records the upstream baseline, verified behaviour, shared Project Plan, and remaining catalogue/cart and scene-ownership integration work.
