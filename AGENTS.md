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
- The user handles `git fetch` and will tell agents when updates are available. Do not fetch unless explicitly asked. At task start and before committing, inspect local branch status and diffs. Before each edit, re-read the relevant files; refresh again after interruptions, changes in scope, or user-reported updates. Preserve teammates' work and reconcile changes before proceeding.
- Prefer the simplest working solution. Check existing code before adding dependencies or patterns.
- Run checks appropriate to the change and record what passed, failed, or could not run in the owner's TODO file.
- Keep secrets out of the repo. Checkout is sandbox-only and requires explicit user approval in the application.

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
