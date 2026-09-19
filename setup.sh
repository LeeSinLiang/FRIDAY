#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "Install Node.js 22.12+ (with npm), then rerun ./setup.sh." >&2
  exit 1
fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Node.js 22.12+ is required."); process.exit(1) }'

export PATH="$HOME/.local/bin:$PATH"
if ! command -v uv >/dev/null; then
  command -v curl >/dev/null || { echo "Install curl to install uv." >&2; exit 1; }
  echo "Installing uv from https://astral.sh/uv/install.sh ..."
  curl --proto '=https' --tlsv1.2 -LsSf https://astral.sh/uv/install.sh | sh
fi
command -v uv >/dev/null || { echo "uv is not on PATH. Add its install directory and rerun." >&2; exit 1; }

if [[ ! -f .env ]]; then cp .env.example .env; fi
(
  cd backend
  if [[ -f uv.lock ]]; then uv sync --locked; else uv sync; fi
  uv run --no-sync python manage.py migrate --noinput
  uv run --no-sync python manage.py check
)
(
  cd frontend
  if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
)
echo "Setup complete. Run ./run-local.sh"
