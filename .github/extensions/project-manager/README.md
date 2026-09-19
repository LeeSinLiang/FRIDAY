# Project Manager

A hackathon Kanban board. Columns are components (Frontend, Backend, AI/ML,
Design, Pitch, etc.); each column holds an ordered stack of task cards
tagged with a phase (`ideation` / `mvp` / `development`). Drag cards up/down
to reprioritize within a component, or drag them into another component's
column to reassign work.

## Two ways to open it

**1. Copilot canvas (recommended in this app)** — the extension is
auto-discovered from `.github/extensions/project-manager/` by any Copilot
CLI/App session in this repo. Ask the agent to open the "Project Manager"
canvas, or call `open_canvas({ canvasId: "project-manager" })`.

**2. Standalone (no Copilot required)** — run it with plain Node from
anywhere, including outside Copilot (e.g. from Codex or CI):

```bash
node .github/extensions/project-manager/bin.mjs
```

This prints a `http://127.0.0.1:<port>/` URL to open in any browser. Both
surfaces read/write the same `data/board.json`, so they always show the
same board — there is only one source of truth.

## Sharing across the team

Everything here — `extension.mjs`, `board.mjs`, `server.mjs`, `bin.mjs`,
and `data/board.json` — is plain committed source. `git push` your changes
and anyone who `git pull`/clones this repo gets the exact same board and
tool automatically; no build step, no extra install. Because `board.json`
is the live shared plan, expect occasional merge conflicts if two people
edit it at the same time — resolve like any other JSON diff.
