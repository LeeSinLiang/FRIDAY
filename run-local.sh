#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
if [[ ! -x backend/.venv/bin/python || ! -f frontend/node_modules/vite/bin/vite.js ]]; then
  echo "Dependencies missing. Run ./setup.sh first." >&2
  exit 1
fi
command -v node >/dev/null || { echo "Node.js is required." >&2; exit 1; }
exec backend/.venv/bin/python scripts/run_local.py
