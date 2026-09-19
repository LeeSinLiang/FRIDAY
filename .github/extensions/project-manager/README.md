# Project Manager

A hackathon Kanban board. Columns are components (Frontend, Backend, AI/ML,
Design, Pitch, etc.); each column holds an ordered stack of task cards
tagged with a phase (`ideation` / `mvp` / `development`). Drag cards up/down
to reprioritize within a component, or drag them into another component's
column to reassign work.

## Two ways to open it

**1. Copilot canvas** — `extension.mjs` provides a Copilot-specific adapter
for hosts supporting the canvas extension API. Ask the agent to open the
"Project Manager" canvas, or call `open_canvas({ canvasId: "project-manager" })`.
Host discovery and SDK support depend on your Copilot installation; use
the standalone mode if that integration is unavailable.

**2. Standalone (no Copilot required)** — run it with plain Node from
the repository root, including outside Copilot (e.g. from Codex or CI):

```bash
node .github/extensions/project-manager/bin.mjs
```

This prints a `http://127.0.0.1:<port>/` URL to open in any browser. Both
surfaces read/write the same `data/board.json` in this checkout. Each
operation reads the latest file under an exclusive lock; writes replace
the JSON atomically. Open panels poll for external changes every 500 ms
and receive updates over SSE. This synchronizes processes sharing the
same local file, with a short refresh delay.

A lock held for more than five seconds makes an operation fail instead
of overwriting another writer. An abrupt process crash can leave
`data/board.json.lock` (and possibly `data/board.json.*.tmp`) behind.
Stop **all** board processes before removing these abandoned files, then
restart. Never delete a lock while a writer could still be running.
Invalid JSON is reported without replacing it; polling resumes after
the file is repaired.

## Sharing across the team

Everything here — `extension.mjs`, `board.mjs`, `server.mjs`, `bin.mjs`,
and `data/board.json` — is plain source. Different machines and separate
checkouts **do not synchronize live**: share board changes through Git
using the repository's feature-branch/review workflow. Never push to main.
Concurrent branch edits may conflict; resolve the JSON like other source.
Stop board processes before Git updates or manual file edits, because
those tools do not participate in the board's write lock. Restart after
resolving conflicts. No build step or third-party dependencies are needed
for standalone mode (use the project's Node.js installation).

## Regression tests

```bash
node --test .github/extensions/project-manager/tests/board.test.mjs
```

Tests use temporary directories and child processes, including a loopback
HTTP server; they never change the committed board. They cover simultaneous
initialization, same-process and cross-process writes, atomic read safety,
fresh reads, migration, failed mutations, invalid JSON recovery, lock
timeouts, and SSE refresh/cleanup. `PROJECT_MANAGER_BOARD_PATH` can override
the board file for isolated testing; every process sharing a board must
use the same path. The Copilot host itself is not exercised by these tests.
