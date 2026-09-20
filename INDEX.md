# Documentation index

Start here to find project docs and team work logs. Add links as docs are created; keep paths current.

Put new Markdown notes and documentation in an appropriate topic folder under `docs/`. Reuse or create folders as needed, including nested folders, and index each file here.

| File | Purpose |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Shared instructions for coding agents, work tracking, and Git |
| [CLAUDE.md](CLAUDE.md) | Symlink to AGENTS.md for Claude Code |
| [README.md](README.md) | Local setup, commands, configuration, API contract, and source layout |
| [proposal.md](proposal.md) | Product proposal, MVP, stack, architecture, and build plan |
| [TODO_SIN.md](TODO_SIN.md) | Sin's tasks and agent work log |
| [TODO_SAKETH.md](TODO_SAKETH.md) | Saketh's tasks and agent work log |
| [TODO_WILLIAM.md](TODO_WILLIAM.md) | William's tasks and agent work log |
| [TODO_ADELLE.md](TODO_ADELLE.md) | Adelle's tasks and agent work log |

## Feature documentation

### Frontend

| Document | Purpose |
| --- | --- |
| [docs/frontend/editor-implementation.md](docs/frontend/editor-implementation.md) | Implemented editor, integration contracts, commands, verification, and remaining handoff |
| [docs/frontend/room-capture/research-and-integration-plan.md](docs/frontend/room-capture/research-and-integration-plan.md) | Selected first-person PlayCanvas/SuperSplat pivot, local reconstruction research, GLB furniture and spatial integration |
| [docs/frontend/3d-engine-plan.md](docs/frontend/3d-engine-plan.md) | Current 3D foundation scope, contracts, multi-agent build plan, and quality gates |
| [docs/frontend/rendering-and-furniture-workflow.md](docs/frontend/rendering-and-furniture-workflow.md) | Rendering-engine comparison and furniture asset workflow research |
| [docs/frontend/3d-object/collaborator-handoff.md](docs/frontend/3d-object/collaborator-handoff.md) | Furniture collaborator instructions, GLB deliverables, dimensions, and acceptance checks |
| [docs/frontend/design/visual-directions.md](docs/frontend/design/visual-directions.md) | Three futuristic furniture-editor concepts, saved images, and generation prompts |
| [docs/frontend/design/selected-direction.md](docs/frontend/design/selected-direction.md) | Selected warm ivory/terracotta Atelier liquid glass, Noir room-box, Japandi/wabi-sabi materials, PP Mori, and motion guidance |

### Backend

- [Blender MCP-style scene and object context: Saketh handoff](docs/backend/contracts/blender-mcp-agent-handoff.md) — pinned official/community references, model-facing metadata/images, complete capability map, implementation order, and acceptance checks.

- [Spatial engine tools and screenshots](docs/backend/contracts/spatial-engine-tools.md) — explicit placement results, dry runs, selectable cameras, revision-specific PNGs, and Python agent adapters.

- [Scene persistence and agent command API](docs/backend/contracts/scene-api.md) — session storage, validation, revisions, CSRF, and agent adapter handoff.

### Setup and tooling

- [Visa/auth integration handoff and branch-sharing workflow](docs/handoffs/visa-auth-integration.md)
- [Account signup, SMTP and local email verification, authenticator MFA, recovery, and approved checkout](docs/account-mfa-checkout.md)
- [Sanitized real IDX response from the MFA-approved checkout](docs/evidence/account-checkout-2026-09-19.json)
- [Visa IDX sandbox tester, evidence, and account/MFA/commerce implementation plan](docs/visa-sandbox.md)
- [Sanitized live Visa IDX sandbox responses](docs/evidence/visa-idx-2026-09-19.json)
- [Local setup and full-stack launcher](README.md#local-setup)
- [Backend API, frontend/3D entry points, and configuration paths](README.md#layout)
- [Verification and dependency commands](README.md#checks-and-common-commands)
- [Project-manager board, local synchronization, Git sharing, and regression tests](.github/extensions/project-manager/README.md)
- [Catalogue, search and language layer: shared types, constraint DSL, configuration](docs/backend/catalogue.md)

Add dedicated feature docs here as they are created.
