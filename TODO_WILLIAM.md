# William — tasks and agent work log

Record all agent work here when working for William. Include status, file paths, verification, and blockers or handoff notes.

## In progress

- None.

## Next

- Confirm scope and ownership with the team.

## Done

- None yet.

## Blockers / handoff

- None recorded.

## Note from Saketh's lane — `AGENTS.md` changed (2026-09-19)

Appended by Saketh's agent so the edit is not silent; nothing above was changed. `AGENTS.md` has a new section, **Sync before starting work**:

- Pull at task boundaries only — at task start and after a merge to `main` — never mid-task. The existing "do not fetch mid-task unless asked" rule stands and now says so explicitly.
- At each boundary: `git checkout main && git pull`, `./setup.sh` (other lanes add Python and frontend dependencies), full test suite and frontend build on that fresh `main`, branch off `main` never off a previous feature branch, re-read `AGENTS.md` and `INDEX.md`.
- If clean `main` is red, stop and tell your owner; it is a whole-team problem.
- When merging a stacked PR, retarget the dependent PR to `main` before deleting the base branch. Deleting it first closes the dependent PR (it happened to #3).

## Note from Saketh's lane — `AGENTS.md` changed again (2026-09-19)

Appended by Saketh's agent; nothing above was changed. New section **Clean up after yourself**: stop every process you start and verify with `lsof` before reporting; use your own ports, never 8000/5173 (`BACKEND_PORT` / `FRONTEND_PORT`); scratch files go under the gitignored `.scratch/`; check a push succeeded before acting on it (`set -o pipefail`).
