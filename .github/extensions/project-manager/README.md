# Project Manager

The FRIDAY Kanban board displays the user's existing project components as
columns and ordered task cards coloured by owner: William, Sin, Saketh,
Adelle, or Unassigned. Completion and priority remain separate. Add tasks
below a column, select their owner, and drag or use the move controls.

Owner-aware schema version 2 is supported by the standalone UI and optional
canvas adapter shipped together here. Migration preserves component names,
IDs, order, task metadata and historical `phase` values; a phase never
implies an owner. Legacy phase model operations remain available for
compatibility, while the UI displays owners rather than misleading phase
defaults. The two existing phase values from the parent snapshot are retained.

## Open from Codex or a terminal

Run the local Kanban from the repository root:

```bash
node .github/extensions/project-manager/bin.mjs
```

Codex can maintain the board and owner TODOs as part of development. FRIDAY's
application agent uses the OpenAI API through the OpenAI Agents SDK; the
Kanban itself is a local task tracker and makes no model API calls.

`extension.mjs` also provides an optional adapter for hosts supporting its
canvas extension API. The standalone launcher works independently of that
adapter.

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
use the same path. The optional canvas host itself is not exercised by these tests.
