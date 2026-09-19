# Agent instructions

## Start here

- Read [INDEX.md](INDEX.md) first, then the relevant docs and owner's TODO file.
- Read [proposal.md](proposal.md) for product scope. Keep the 19-hour MVP small; avoid speculative abstractions and unrelated changes.
- The stack is Python, Django API, Docker, TypeScript, React, and Three.js, with OpenAI Agents SDK, Elasticsearch, Deepgram, and Visa sandbox integrations.

## Track all work

- Every agent must record its work in the current owner's TODO file: plan/status, changes and file paths, verification results, and blockers or handoff notes.
- Update the TODO when starting work and before handing it back. Do not mark unfinished or unverified work complete.
- Available work logs: [TODO_SIN.md](TODO_SIN.md), [TODO_SAKETH.md](TODO_SAKETH.md), [TODO_WILLIAM.md](TODO_WILLIAM.md), and [TODO_ADELLE.md](TODO_ADELLE.md).
- If the user has not specified their TODO file or identity in the conversation, list all four options first and ask which file to update. Wait for their answer before writing a work log; never assume a default owner.
- Keep INDEX.md current whenever documentation is added, moved, or removed. Include docs for specific frontend/backend features as they are created.
- Respect teammates' changes. Agree on shared contracts and ownership before overlapping work; do not infer owners from the proposal's P1–P4 labels.

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
