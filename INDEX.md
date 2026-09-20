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

- [Team room setup](docs/frontend/room-capture/team-room-setup.md) — one-command checked import of the prepared room, packaging and sharing instructions.

| Document | Purpose |
| --- | --- |
| [docs/product/PRODUCT.md](docs/product/PRODUCT.md) | Confirmed product purpose, laptop/local constraints, current capabilities and selected first-person direction |
| [docs/frontend/room-capture/haussmann-apartment.md](docs/frontend/room-capture/haussmann-apartment.md) | Promising CC BY empty-room Gaussian candidate, acquisition gate, visual inspection and pending integration checks |
| [docs/frontend/room-capture/gaussian-splatting-handoff.md](docs/frontend/room-capture/gaussian-splatting-handoff.md) | Separate task: find a free similar empty-room splat or fully convert the source mesh, with coverage and integration gates |
| [docs/frontend/room-capture/parallel-visual-tracks.md](docs/frontend/room-capture/parallel-visual-tracks.md) | Mesh versus Gaussian task ownership, separate-session handoff, shared contracts and demo comparison gates |
| [docs/frontend/room-capture/rendering-alternatives.md](docs/frontend/room-capture/rendering-alternatives.md) | Baked mesh, runtime lightmaps, architectural viewers, browser path tracing and panorama tradeoffs |
| [docs/frontend/room-capture/cg-arch-interior.md](docs/frontend/room-capture/cg-arch-interior.md) | Selected Blendkit room, local export, texture handling, living-room placement zone and sharing requirements |
| [docs/frontend/room-capture/empty-mesh-room.md](docs/frontend/room-capture/empty-mesh-room.md) | Optional authored empty mesh fixture, reproducible GLB, exact interior bounds and retained Studio 11 route |
| [docs/frontend/room-capture/playcanvas-implementation.md](docs/frontend/room-capture/playcanvas-implementation.md) | Implemented local Studio 11 editor, preparation, fixed geometry, interaction, captures and integration boundaries |
| [docs/frontend/editor-implementation.md](docs/frontend/editor-implementation.md) | Historical Three.js editor, available through `?legacy`, with integration and verification notes |
| [docs/frontend/room-capture/first-person-playcanvas-plan.md](docs/frontend/room-capture/first-person-playcanvas-plan.md) | Active Ambic-style first-person migration plan: Atelier UI, prepared splat rooms, GLB editing, spatial/catalogue/capture contracts and parallel ownership |
| [docs/frontend/room-capture/surface-generation-methods.md](docs/frontend/room-capture/surface-generation-methods.md) | Executable local surface-generation routes: SuperSplat Convert/SplatTransform, uncarved geometry versus walking collision, and optional Record3D/LiDAR reference |
| [docs/frontend/3d-engine-plan.md](docs/frontend/3d-engine-plan.md) | Historical Three.js foundation scope, contracts, multi-agent build plan, and quality gates |
| [docs/frontend/3d-object/sofa-glb-integration.md](docs/frontend/3d-object/sofa-glb-integration.md) | Imported textured sofa, measured dimensions, shared asset path and retirement of primitive catalogue choices |
| [docs/frontend/design/selected-direction.md](docs/frontend/design/selected-direction.md) | Atelier glass, Mori and motion; generated first-person UI concept, reference image and prompt; historical Noir box direction |

| Document | Purpose |
| --- | --- |
| [docs/frontend/region-solver.md](docs/frontend/region-solver.md) | Region solver: floor-grid-v1 placement masks, place-clause rules, unit boundary, proposed Room openings, debug view |
| [docs/frontend/room-capture/research-and-integration-plan.md](docs/frontend/room-capture/research-and-integration-plan.md) | Selected first-person PlayCanvas/SuperSplat pivot, local reconstruction research, GLB furniture and spatial integration |
| [docs/frontend/rendering-and-furniture-workflow.md](docs/frontend/rendering-and-furniture-workflow.md) | Rendering-engine comparison and furniture asset workflow research |
| [docs/frontend/3d-object/collaborator-handoff.md](docs/frontend/3d-object/collaborator-handoff.md) | Furniture collaborator instructions, GLB deliverables, dimensions, and acceptance checks |
| [docs/frontend/design/visual-directions.md](docs/frontend/design/visual-directions.md) | Three futuristic furniture-editor concepts, saved images, and generation prompts |

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
