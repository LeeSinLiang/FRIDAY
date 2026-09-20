# Agent instructions

## Start here

- Read [INDEX.md](INDEX.md) first, then the relevant docs, owner's TODO file, and current [Kanban board](.github/extensions/project-manager/data/board.json). See the [board guide](.github/extensions/project-manager/README.md) for launch and editing instructions.
- Read [proposal.md](proposal.md) for product scope. Keep the 19-hour MVP small; avoid speculative abstractions and unrelated changes.
- The stack is Python, Django API, Docker, TypeScript, React, and Three.js, with OpenAI Agents SDK, Elasticsearch, Deepgram, and Visa sandbox integrations.

## Track all work

- Every agent must record its work in the current owner's TODO file: plan/status, changes and file paths, verification results, and blockers or handoff notes.
- Keep the Kanban and owner's TODO synchronized when starting work, after every meaningful code or documentation edit, after verification, and before handoff. Update the existing task for the work; do not create a card for every file or keystroke. Re-read both records before changing them so concurrent updates survive.
- Perform these updates as part of the work without waiting for a separate reminder. These instructions require the agent to maintain the board; the extension does not infer tasks from file changes.
- Available work logs: [TODO_SIN.md](TODO_SIN.md), [TODO_SAKETH.md](TODO_SAKETH.md), [TODO_WILLIAM.md](TODO_WILLIAM.md), and [TODO_ADELLE.md](TODO_ADELLE.md).
- If the user has not specified their TODO file or identity in the conversation, list all four options first and ask which file to update. Wait for their answer before writing a work log; never assume a default owner.
- Keep INDEX.md current whenever documentation is added, moved, or removed. Include docs for specific frontend/backend features as they are created.
- Respect teammates' changes. Agree on shared contracts and ownership before overlapping work; do not infer owners from the proposal's P1–P4 labels.

### Maintain the Kanban and active TODOs

- The board at `.github/extensions/project-manager/data/board.json` is the shared task list. Owner TODO files hold the current plan, detailed progress, verification, and completed-work history. Use the same task wording in both so the records can be matched.
- Preserve the user's current component names, IDs, and order. Add or update tasks under those existing components. Do not rename, add, remove, or regenerate components from an older proposal or seed unless the user requests it.
- Before implementation, find or add the relevant card and record the plan under **In progress** in the confirmed owner's TODO. Assign the agreed owner; leave unconfirmed ownership **Unassigned**. Keep existing task IDs, ownership, completion, and priority unless the work calls for changing them.
- As scope changes, add newly discovered actionable tasks, revise affected task titles or priority, and remove duplicates, cancelled work, or obsolete tasks only with a recorded reason. Keep blocked and unverified work active and explain the blocker in the TODO. Do not delete a task merely because its title is vague or it looks like a placeholder.
- After verification, mark the card done and move the matching TODO item out of **In progress** or **Next** into **Done**, recording changed paths and the actual checks/results. Completed cards may then be removed to keep the active board concise, but retain their completion evidence in the owner's TODO. Never claim implementation, payment approval, or a vendor order from a plan or an unverified integration.
- Prefer the running board's HTTP API or canvas actions for edits; they use its write lock and notify open tabs. Read the current board first and make targeted task changes. If direct JSON edits are necessary, stop this checkout's board server first, re-read and preserve the latest data, then restart and verify it. Git and manual file edits do not participate in the board write lock.
- A handoff is incomplete until the affected Kanban cards, active TODO items, completed-work record, and relevant documentation agree. For runnable changes, verify the refreshed artifact through the user's actual launch path before marking the work done.

## Documentation organization

- Put every new Markdown note or documentation file under `docs/<appropriate-folder>/`. Reuse an existing topic folder when it fits; otherwise create one. Nested folders are welcome when they make the subject easier to find (for example, `docs/frontend/` or `docs/backend/contracts/`).
- Add every such file to the root [INDEX.md](INDEX.md). When moving or renaming documentation, update its index entry and affected relative links in the same change.
- Before handing work back, verify every Markdown file created under `docs/` has a working link in INDEX.md. Documentation work is not complete until its index entry is present; do not defer indexing to a later commit or another agent.
- This is a repository-wide convention, including work intended for `main`.

## Implement and verify

- If the project has not been set up locally, run `./setup.sh` from the repository root first.
- Use `./run-local.sh` from the repository root to run the full stack for development and manual/integration testing. Ctrl-C stops both servers. Run automated checks separately as documented in README.md.
- This is a rapid, multi-person hackathon: expect frequent pushes and concurrent edits. Always check the latest state before acting; code read even five messages ago may already have changed.
- The user handles `git fetch` and will tell agents when updates are available. Do not fetch or pull mid-task unless explicitly asked: the ground must not shift under work in progress. The sync below happens only at task boundaries. At task start and before committing, inspect local branch status and diffs. Before each edit, re-read the relevant files; refresh again after interruptions, changes in scope, or user-reported updates. Preserve teammates' work and reconcile changes before proceeding.
- Prefer the simplest working solution. Check existing code before adding dependencies or patterns.
- Run checks appropriate to the change and record what passed, failed, or could not run in the owner's TODO file.
- Keep secrets out of the repo. Checkout is sandbox-only and requires explicit user approval in the application.

## Sync before starting work

Pull at task boundaries — at task start and after a merge to `main` — never mid-task:

1. `git checkout main && git pull`
2. `./setup.sh` — other lanes add Python and frontend dependencies
3. Run the full test suite and the frontend build on that fresh `main`
4. Branch new work off `main`, never off a previous feature branch
5. Re-read `AGENTS.md` and `INDEX.md` — teammates change them

- If clean `main` is red, **stop and tell your owner.** That is a whole-team problem, not something to work around.
- When merging a stacked PR, retarget the dependent PR to `main` **before** deleting the base branch. Deleting it first closes the dependent PR instead of retargeting it.

## Trust the remote, not your terminal

Pushing and merging both change the remote. Neither tells you the truth about it through your local state, and both failures below are the same failure.

**After every push:**

- Never pipe a git command whose exit code matters. Read `push`, `merge`, `pull` and `fetch` output directly; a pipe reports the last command's status and hides a rejection.
- Verify the remote, not the terminal: `git rev-parse HEAD` must equal `git rev-parse origin/<branch>`.
- **A chain that runs tests, builds or git commands stops on the first failure.** Join steps with `&&`, never `;`. In a script, `set -euo pipefail` at the top. Never a pipe that eats an exit code (`npm test | tail` reports `tail`'s success); write to a log file and read it. Do not assume `set -e` works in the shell your tool gives you: one agent's did not, and a chain ran past a failed merge and deleted a branch. A red test has been pushed twice here because a chain kept going.
- A behavioural claim in a PR description needs a test behind it. A PR once merged describing behaviour its branch did not contain, because the push carrying it had been rejected, and nothing went red.

**After every merge, no exceptions.** Merging happens on GitHub. It updates `main` on the remote. It does not update your clone, your branch or your working tree, and you are now behind by everything the other lanes merged while you worked.

1. `git checkout main`
2. `git pull`
3. Delete the merged branch locally
4. **Run the full suite and the frontend build on that fresh `main`**
5. Branch fresh for the next task

Step 4 is the one that is not optional and the one that gets skipped. A PR is tested against the `main` it was cut from, never the `main` it lands in: two green PRs can merge with no textual conflict and take `main` down together. That has already happened here, when a database-backed cache met another lane's database-free tests. **Whoever merges runs the suite on fresh `main` at once, and if it is red tells the team before doing anything else.** A red `main` is a whole-team stop, not something to fix quietly on your next branch.

## Merging close to the demo

- **Small PRs, one concern each.** A big merge at this hour is how a working demo dies.
- **The full suite runs on fresh `main` after every merge**, by whoever merged, as above. It has already caught `main` red once from a PR merged without it.
- **A clean textual merge is not a working merge.** After resolving a conflict in a shared file, run the thing, not just the tests. Especially anything that touches the editor.
- Never force-push, never rebase anything already pushed.
- **`main` freezes once the demo has been rehearsed end to end on the machine we present from.** From that moment, the only changes allowed are fixes to something that breaks the rehearsed run. No polish, no refactors, no "while I'm in here". The way this goes wrong is a reasonable change landing an hour before the demo and breaking the exact path we practised. If you are unsure whether the freeze has started, ask before merging.

## Clean up after yourself

- **Every process you start, you stop.** Before reporting, verify nothing you started is still listening (`lsof -nP -iTCP:<port> -sTCP:LISTEN`) and say in the report that you checked. No orphaned dev servers, headless browsers or background `npm run dev`.
- **Use your own ports, never 8000 or 5173.** Those belong to the owner's running stack. Set `BACKEND_PORT` and `FRONTEND_PORT` for anything you launch, e.g. `BACKEND_PORT=8211 FRONTEND_PORT=5211 ./run-local.sh`.
- **Leave no litter.** Screenshots and scratch files go under `.scratch/` at the repository root, which is gitignored. Never write into the folder that contains the clone.

## Git

- Work on a feature branch (default prefix: `codex/`). Do not commit directly to `main`.
- **Never push to `main`, including force pushes.** Push other branches only when explicitly requested.
- Before committing, inspect the staged diff and include only intended changes.
- Every commit must have a short, imperative subject for humans, a blank line, and a detailed body for future humans and coding agents. Never use a subject-only commit.
- The body must explain what changed, the affected parts, why it was needed, and relevant behavior, compatibility, configuration, risks, and verification. Describe every staged change accurately.

```text
<Short imperative summary, e.g. feat/filtering-catologue>

<What changed, where, and why>

<Relevant effects, risks, and verification>
```
