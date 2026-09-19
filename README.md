# FRIDAY · HackMIT 2026

Django REST Framework API + React/TypeScript/Vite frontend with Three.js through React Three Fiber.

## Local setup

Requires macOS/Linux (or WSL), Node.js 22.12+ with npm, and internet access for initial installation.

```bash
./setup.sh
./run-local.sh
```

`setup.sh` checks Node/npm, installs uv if missing using Astral's official installer, creates `.env` only if absent, syncs the Python 3.12 environment, runs Django migrations/checks, and installs frontend dependencies. uv can download Python if needed. Rerun setup after dependency or migration changes; existing `.env` and database data are preserved. Keep the generated lockfiles in Git for reproducible installs.

- Frontend: http://127.0.0.1:5173
- API health: http://127.0.0.1:8000/api/health/
- Django admin: http://127.0.0.1:8000/admin/

Both servers reload on edits. Ctrl-C stops both, including reload workers. Occupied ports fail with a clear error; edit `BACKEND_PORT` / `FRONTEND_PORT` in `.env` to use other ports. Shell environment variables take precedence. These scripts run locally without Docker.

## Layout

| Path | Purpose |
| --- | --- |
| `backend/config/` | Django settings, URLs, ASGI/WSGI entry points |
| `backend/api/` | REST routes, health endpoint, API tests |
| `backend/pyproject.toml`, `backend/uv.lock` | Python dependencies and lockfile |
| `frontend/src/App.tsx` | Starter screen and backend health request |
| `frontend/src/Scene.tsx` | Lazy-loaded React Three Fiber starter scene |
| `frontend/vite.config.ts` | Dev server and `/api` proxy to Django |
| `frontend/package.json`, `frontend/package-lock.json` | Frontend commands, dependencies, lockfile |
| `.env.example` | Shareable local configuration template |
| `setup.sh` | Dependency setup and database migrations |
| `run-local.sh`, `scripts/run_local.py` | Full-stack dev process lifecycle |

The API uses SQLite locally. `GET /api/health/` is public and returns `{"status":"ok","service":"friday-api"}`. Other REST views require authentication by default unless explicitly overridden. Call `/api/...` from the frontend; Vite proxies these requests to Django, so no local CORS setup is needed. Production hosting must route `/api` separately; Vite's dev proxy is not bundled into the frontend build.

## Checks and common commands

```bash
(cd backend && uv run python manage.py check)
(cd backend && uv run python manage.py test api)
(cd frontend && npm run build)
(cd backend && uv run python manage.py createsuperuser)
```

Add backend dependencies with `cd backend && uv add <package>`; frontend dependencies with `cd frontend && npm install <package>`. Keep both lockfiles in Git. React is constrained to 19.2 because the installed React Three Fiber 9 peer range excludes React 19.3.

The local settings default to debug mode and a development-only secret. Deployment needs a real `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, allowed hosts, and a production server/static-file strategy. No Docker or deployment configuration is scaffolded yet.

See [INDEX.md](INDEX.md) for project docs and team work logs.
