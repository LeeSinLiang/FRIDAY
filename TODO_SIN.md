# Sin — tasks and agent work log

Record all agent work here when working for Sin. Include status, file paths, verification, and blockers or handoff notes.

## In progress

- None.

## Next

- Confirm team ownership and shared contracts before implementation; P1–P4 are not yet mapped to names.

## Done

- 2026-09-19: Prepared standalone furniture collaborator handoff with approved warm Atelier reference image, Japandi material guidance, GLB units/pivot/material requirements, and rendering/creation workflow research. Included docs/frontend/3d-object/collaborator-handoff.md, docs/frontend/rendering-and-furniture-workflow.md, docs/frontend/design/images/06-warm-atelier-glass.png, and matching INDEX.md entries. Verified local links, metadata JSON, PNG signature, and whitespace. No runtime changes or integration claims; no branch switch or push.

- 2026-09-19: Fixed project-manager persistence in .github/extensions/project-manager/board.mjs and server.mjs on codex/fix-project-manager-sync. Fresh reads and mutations use an exclusive lock, writes atomically replace JSON, and server polling broadcasts external updates over SSE with cleanup on close. Added tests/board.test.mjs and tests/worker.mjs for four-process concurrent initialization/writes (80 tasks), atomic read safety, migration, detached reads, failure/invalid-JSON recovery, external SSE refresh and shutdown, and lock timeout/recovery. All 4 tests passed; loopback test required sandbox escalation after EPERM. Updated extension README, INDEX.md, and .gitignore. git diff --check passed; committed board.json unchanged. Limitations: abandoned crash locks require stopping all writers before manual removal; Git/manual writes do not use this lock; cross-machine sharing remains Git-based; Copilot host not runtime-tested. No fetch, commit, or push.
- 2026-09-19: Reviewed .github/extensions/project-manager for OpenAI Challenge fit. Standalone HTTP smoke check passed (200, six columns, two sample tasks); server stopped. Copilot adapter present but not runtime-verified; no OpenAI calls, TODO sync, or root-launcher integration found. Identified process-local board caching as a cross-session stale-write risk. Recommended FRIDAY milestones, owner/acceptance/evidence fields, and a concrete Codex debugging/demo record. No implementation or board-data changes; no fetch or push.
- 2026-09-19: Added AGENTS.md instructions to run ./setup.sh when local setup is missing and ./run-local.sh for development and manual/integration testing. Automated checks remain separate. Documentation-only change; verified diff formatting and CLAUDE.md symlink consistency.
- 2026-09-19: Prepared the full setup for a local commit on main with the user's explicit one-time authorization. Includes proposal.md, shared agent instructions/index/work logs, ignore rules, backend/frontend source and lockfiles, environment template, setup/run scripts, and README. Prior setup verification is recorded below; no fetch or push requested.
- 2026-09-19: Updated AGENTS.md so the user handles git fetch and notifies agents of updates. Agents still check local status/diffs and re-read files before editing. Reviewed the wording; no fetch performed.
- 2026-09-19: Scaffolded backend/config and backend/api with Django 5.2, REST Framework, SQLite, public GET /api/health/, authenticated-by-default REST settings, and uv dependencies/lockfile. Added frontend with React 19.2, TypeScript, Vite, lazy-loaded Three.js/React Three Fiber scene, API health status, and /api dev proxy. React 19.2 matches Fiber's current peer requirement.
- Added setup.sh (Node/npm checks, uv install when absent, environment template, dependency sync, migrations), run-local.sh and scripts/run_local.py (both dev servers, reload, port checks, process-group cleanup), and .env.example. Documented commands/layout in README.md and linked sections in INDEX.md. Working branch: codex/full-stack-setup.
- Verification: first and repeat setup passed; Django checks and 2 API tests passed; TypeScript/Vite production build passed; direct/proxied health and frontend HTTP checks passed; occupied-port guard and SIGINT cleanup passed. Three.js emits a large-chunk warning despite lazy loading. Browser rendering and the uv-absent installer path were not exercised. Test servers stopped; no commit or push performed. Remote freshness remains unverified because GitHub SSH authentication failed.
- 2026-09-19: Made AGENTS.md owner-neutral: list all four TODO files and ask which to use when the conversation does not identify the owner. Removed the current-user label from INDEX.md and recorded the confirmed stack in AGENTS.md. Added .gitignore for Python/Django, TypeScript/React, Docker local data, secrets, and generated files while keeping lockfiles, migrations, and Three.js assets trackable. Verification: all 21 ignore/keep cases passed, CLAUDE.md still matches AGENTS.md, and git diff --check passed. Remote freshness could not be verified: git fetch origin failed with GitHub SSH public-key authentication. No commit or push performed.
- 2026-09-19: Added rapid-collaboration rules to AGENTS.md: check remote updates at task start and before commits, re-read relevant files and local diffs before edits, and never assume code from earlier messages is unchanged. Verified final wording and that CLAUDE.md still resolves to the same instructions; documentation-only change.
- 2026-09-19: Initialized AGENTS.md with INDEX.md-first reading, simple MVP scope, mandatory owner work logs, short commit subjects with detailed bodies, and a prohibition on pushing to main.
- Created INDEX.md, TODO_SIN.md, TODO_SAKETH.md, TODO_WILLIAM.md, and TODO_ADELLE.md. Added CLAUDE.md as a relative symlink to AGENTS.md for Claude Code.
- Verification: checked all local links in AGENTS.md and INDEX.md, all four indexed TODO files, and the symlink target/content. All passed. No application code changed; no application tests needed. No commit or push performed.

## Blockers / handoff

- The user confirmed TypeScript, React, Three.js, Python/Django API, and Docker; proposal.md still describes the frontend choice as undecided.
