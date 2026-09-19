# Project Manager

The FRIDAY Kanban board uses the team's current components in
[`data/board.json`](data/board.json). Keep those user-edited components;
use [proposal.md](../../../proposal.md), [README.md](../../../README.md),
and team notes to add the actual tasks. Cards show who owns the work.
Vertical order sets priority, and the checkbox marks verified completion.

## Owners and project areas

Each card has an owner selector and matching colour: **William** (blue),
**Sin** (amber), **Saketh** (teal), **Adelle** (purple), or **Unassigned**
(grey). The name is always visible, so colour is not the only signal.
New cards start Unassigned. Assign people only when ownership is agreed;
the proposal's P1–P4 roles are not a mapping to names.

The current components, in the user's order, are:

1. 3D Platform
2. Elastic Database
3. Frontend & UX
4. Cart & Visa IDX
5. Agent Harness
6. Demo Video + Presentation

Column headers show the name and task count, without scope descriptions.
Do not restore the older seed components over this plan.

The 2026-09-19 task import comes from the user's whiteboard photo
`IMG_5126.HEIC`: room/video modelling, floor-plan geometry, furniture
models, spatial constraints, vendor indexing/search, scene/UI state,
speech input, agent tools, Visa authentication, and an ElevenLabs demo
narration option. These are open tasks, not implementation claims.
Owners are assigned only where the photo clearly associates the work:
Adelle with object models, Sin with the UI/3D platform, and Saketh with
constraints and Visa. The remaining cards are Unassigned. Optional
techniques are evaluation tasks, not changes to the agreed stack.

The Visa column uses the user's supplied IDX integration context. A returned
Match Key is not payment approval or a vendor order; those need separate
integrations and evidence. The board's columns describe planned scope,
not proof that those features are implemented. Keep verification and
handoff details in the confirmed owner's `TODO_<OWNER>.md`.

## Keep tasks and work logs current

Follow [AGENTS.md](../../../AGENTS.md#maintain-the-kanban-and-active-todos).
At task start, match an existing card or add one under an existing component,
and record the plan in the confirmed owner's TODO. After each meaningful
code/doc edit and verification step, update the affected card and work log.
Add discovered work, explain blockers, and remove duplicates or obsolete
tasks with a recorded reason. Preserve other people's cards and column edits.
Agents must perform this upkeep without a separate reminder; there is no
background watcher that converts source edits into tasks.

When work is verified, check its card and move the active TODO item into
**Done**, including changed files and verification evidence. A completed card
can then be removed; its history stays in the owner's TODO. Do not leave
finished items in **In progress** or **Next**, or mark blocked work complete.

While the server is running, use its API for targeted task changes:
`GET /api/board`, `POST /api/task`, `POST /api/task/:id/owner`,
`POST /api/task/:id/toggle` with `{ done: true }`, and
`DELETE /api/task/:id`. Use the current printed port. Do not overwrite the
JSON behind a live process; its cache can replace those edits.

## Two ways to open it

**1. Copilot canvas (recommended in this app)** — the extension is
auto-discovered from `.github/extensions/project-manager/` by any Copilot
CLI/App session in this repo. Ask the agent to open the "Project Manager"
canvas, or call `open_canvas({ canvasId: "project-manager" })`.

**2. Standalone (no Copilot required)** — run it with plain Node from the
repository root, including outside Copilot (e.g. from Codex or CI):

```bash
node .github/extensions/project-manager/bin.mjs
```

This prints a `http://127.0.0.1:<port>/` URL to open in any browser. Both
surfaces read/write this checkout's `data/board.json`. Another clone has
its own board file. Run one board server per checkout; separate processes
cache their state and do not watch external file changes. After pulling
board changes, editing the JSON directly, or changing the server code,
stop the server with Ctrl+C, rerun the command, and open its newly printed
URL. Reloading the browser alone does not reload the server code or cache.

## Using the board

- **Add a task:** type a title in the `Add task…` field under the intended
  column, then click **Add** or press Enter. An empty title shows a message.
- **Move a task:** drag the card onto a column's empty space to append it,
  or onto the upper/lower half of another card to place it before/after.
  The gaps between cards also accept drops.
- **Move without dragging:** use the card's **Move to component…** selector,
  or its up/down buttons to change priority within the current column.
- **Owner and completion:** choose the person from the coloured owner
  selector. The card tint and border follow that owner. Check completion
  after the work is verified; changing the owner does not change completion.
- **Components:** use **+ Add component**, edit a column's name, or remove
  it with its close button. Removing a component also removes its tasks.

Actions save immediately. The message above the board reports success or
failure, and an unsuccessful add keeps the entered title. Successful
actions refresh their view directly; other open tabs on the same server
receive live events. If the board reports a lost connection, check that
the terminal running the server is still open and use its current URL.

## Board data and migration

`data/board.json` uses `schemaVersion: 2`. Tasks contain `id`, `title`,
`done`, and `owner`. Legacy component `description` metadata is retained
for compatibility but is not displayed.
On first load, older flat or phase-grid boards migrate to named owners.
Existing task IDs, titles, completion, and other task metadata are retained;
the retired phase field is removed and never converted into a guessed owner.
Existing valid owners are preserved, while missing owners become Unassigned.

The migration combines Frontend and Design/UX into Frontend & UX, and
Problem & Idea and Pitch & Demo into Integration & Demo. Existing API
and data columns become Backend & API and Catalogue & Elasticsearch.
It adds the remaining documented project areas and keeps custom columns.
This happens once: later column renames or removals survive restarts.

The HTTP API accepts `{ componentId, title, owner? }` at `POST /api/task`,
and `{ owner }` at `POST /api/task/:id/owner`. `GET /api/meta` supplies the
five owner IDs, labels, and colours. The Copilot actions use optional
`owner` in `add_task` and `set_task_owner` for assignment. Restart/reload
the extension after upgrading; the old phase API/actions are retired.

## Verification

No bundle or dependency install is required for the standalone board.
From the repository root, run:

```bash
node --test .github/extensions/project-manager/board.test.mjs
node --check .github/extensions/project-manager/server.mjs
```

The tests use a temporary copy and never modify the project's board.
For browser verification, launch `bin.mjs`, add disposable tasks, drag to
an empty column and to the bottom of a populated column, try the move
selector, change the owner, then reload to confirm persistence and remove
the test tasks. Automated tests also cover both old board formats,
owner validation, and preservation of customisations after migration.

## Sharing across the team

Everything here — `extension.mjs`, `board.mjs`, `server.mjs`, `bin.mjs`,
and `data/board.json` — is plain committed source. `git push` your changes
and anyone who `git pull`/clones this repo gets the exact same board and
tool automatically; no build step, no extra install. Because `board.json`
is the live shared plan, expect occasional merge conflicts if two people
edit it at the same time — resolve like any other JSON diff.
