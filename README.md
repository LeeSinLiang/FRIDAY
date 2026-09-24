# FRIDAY

**Furnish Rooms Intelligently. Design Around You.**

### 🏆 3rd place — OpenAI “5th Teammate” Challenge · HackMIT 2026

**An AI design teammate that works inside your room.**

FRIDAY turns a conversation into a furnished, editable 3D space. Walk through an immersive room, describe the look you want, and work with an AI teammate that finds furniture, reasons about placement, and builds designs you can compare and refine.

![FRIDAY furnishing the Haussmann apartment, with three bedroom designs under the demo’s $1,200 budget](docs/assets/friday-room-design.png)

*A $1,200 brief. Three design directions. One room to explore and make your own.*

## From a conversation to a furnished room

> “Hey Friday, I have a $1,200 budget. Can you help me design my room?”

1. **Step into the space.** Explore a prepared room, walk through it in first person, or switch to the floor-plan view.
2. **Describe your idea.** Use text or voice to ask for a warm bedroom, a different sofa, or a new arrangement.
3. **Compare three directions.** The bedroom demo creates three five-piece designs, checked against its $1,200 budget. Preview each design in the room.
4. **Refine it together.** Ask for a brown sofa or move a lamp beside the sofa. Refine the active draft while keeping the alternatives available.
5. **Make the choice.** Lock in a design, review its furniture in the cart, and explicitly approve the account- and MFA-protected Visa sandbox checkout.

Furniture discovery, spatial decisions, and cart review stay connected throughout the experience.

## An agent that can act on its ideas

FRIDAY connects the **OpenAI Agents SDK** to tools that operate on the room itself:

- **Understand the scene.** Inspect existing objects, their dimensions and positions, and the space around them.
- **Find the right pieces.** Search a model-backed furniture catalogue and use product metadata to inform the design.
- **Reason about placement.** Measure clearances and position furniture relative to other objects. Geometry checks validate supported placements before scene changes are committed.
- **See the result.** Request rendered screenshots from the open editor for visual feedback, tied to the scene revision.
- **Keep the design editable.** Stage changes, refine a selected draft, and save accepted arrangements while preserving the shopper’s control over the final choice.

The experience combines Gaussian-splat and mesh environments with editable GLB furniture. The public room gallery includes the Haussmann apartment, a light-filled studio, and the London skyscraper, subject to asset availability.

## How it works

![FRIDAY system architecture: browser editor, Django services, AI tools, external providers, and data storage](docs/assets/friday-architecture.png)

[Open the architecture diagram at full resolution](docs/assets/friday-architecture.png)

The browser renders the room, handles interactive placement, and supplies screenshots to the agent. Django manages saved scenes, revisions, design jobs, accounts, carts, and checkout records. The active renderer is **PlayCanvas**; the earlier **Three.js / React Three Fiber** editor remains accessible through `/?legacy`.

| Layer | Technology |
| --- | --- |
| Interface | React 19, TypeScript, Vite |
| 3D scene | PlayCanvas, Gaussian splats, GLB furniture |
| API and persistence | Django, Django REST Framework, SQLite locally; PostgreSQL configuration for deployment |
| AI design | OpenAI Agents SDK with application-defined scene and catalogue tools |
| Product discovery | Elasticsearch with a local in-memory catalogue fallback |
| Speech | Browser speech recognition or server-side OpenAI / Deepgram transcription; Deepgram spoken replies |
| Identity and checkout | django-allauth, authenticator MFA, Visa IDX sandbox |

Catalogue search can use Elasticsearch; the designer’s model-search tool also has its own local catalogue path. See the [system architecture](docs/architecture/system.md) and [scene designer guide](docs/backend/scene-designer/README.md) for the detailed boundaries.

## Local setup

Requires **macOS, Linux, or WSL**, **Node.js 22.12+ with npm**, and internet access for initial installation and any downloaded room assets.

From the repository root:

```bash
./setup.sh
./run-local.sh
```

`setup.sh` installs uv if needed, creates `.env` from `.env.example` if absent, syncs the Python environment, installs frontend dependencies, runs migrations, and initializes the database cache and local MFA encryption key. uv can provision Python. Existing `.env` and database data are preserved.

Open **http://127.0.0.1:5173**, enter the gallery, and choose an available room. The API health endpoint is **http://127.0.0.1:8000/api/health/** and the Django admin is at **http://127.0.0.1:8000/admin/**.

Both servers reload during development; **Ctrl-C stops both**. To use different ports:

```bash
BACKEND_PORT=8211 FRONTEND_PORT=5211 ./run-local.sh
```

Shell variables override `.env`. The launcher reports occupied ports instead of replacing an existing server. Docker is not required for this local workflow.

### Configuration

Keep credentials in the private root `.env`; use [.env.example](.env.example) as the configuration reference. Restart the relevant server after changing settings.

| Capability | Configuration |
| --- | --- |
| Local catalogue browsing | `SEARCH_BACKEND=memory` (default); no Elasticsearch credentials needed |
| AI design and language interpretation | `OPENAI_API_KEY` |
| Elasticsearch search | `SEARCH_BACKEND=elastic`, `ELASTIC_URL`, `ELASTIC_API_KEY`, and a populated catalogue index |
| Speech input | `STT_PROVIDER=browser`, `openai`, or `deepgram`; server providers require their corresponding API key. `TRANSCRIBE_BACKEND` is a compatibility fallback. |
| Spoken replies | `DEEPGRAM_API_KEY` |
| Local account verification | Development-only private inbox via `AUTH_LOCAL_INBOX_ENABLED`; configure SMTP for real email |
| Visa sandbox | Private credential configuration described in the [sandbox guide](docs/visa-sandbox.md) |

You can explore available rooms and manually arrange catalogue furniture without AI or payment credentials. AI design, provider-backed speech, and sandbox submission require their respective services. The local database is `backend/db.sqlite3`; preserve its associated MFA key in `backend/.runtime/mfa.key` when keeping account data.

### Room and furniture assets

The room gallery derives its entries from `shared/public-rooms.json` and asset availability. Missing Haussmann assets can be downloaded through the gallery. Large scans and privately licensed room sources are not all bundled in a fresh clone; see the [Haussmann setup guide](docs/frontend/room-capture/haussmann-apartment.md) for preparation and known visual limits.

Room and furniture assets carry their own licenses and attribution requirements. Preserve the supplied credits when redistributing them; see the [ABO furniture asset notes](docs/frontend/3d-object/abo-asset-notes.md) for that collection.

## Checks and common commands

Run from the repository root after setup:

```bash
(cd backend && uv run python manage.py check)
(cd backend && OPENAI_API_KEY= DEEPGRAM_API_KEY= ELASTIC_URL= ELASTIC_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test)
(cd frontend && npm test)
(cd frontend && npm run build)
```

Run the backend suite **without app labels** so it includes every application. These checks also run in [CI](.github/workflows/ci.yml). Provider calls and physical microphone behavior need separate live verification; an offline test run does not establish either.

To create a local admin account:

```bash
(cd backend && uv run python manage.py createsuperuser)
```

Add Python dependencies with `uv add` from `backend/` and frontend dependencies with `npm install` from `frontend/`. Commit the corresponding lockfile changes when updating dependencies.

## Layout

| Path | Purpose |
| --- | --- |
| `frontend/src/App.tsx` | Entrance, gallery, room, account, cart, and checkout routing |
| `frontend/src/SplatEditor.tsx` | Active room editor and design interaction |
| `frontend/src/scene/` | Spatial tools, room state, design UI, and PlayCanvas integration |
| `frontend/src/shopping/`, `auth/`, `checkout/` | Shopping, identity, approval, and receipt UI |
| `backend/api/` | Saved scenes, geometry validation, designer jobs, and agent tools |
| `backend/catalogue/` | Product search, language constraints, and speech endpoints |
| `backend/shopping/`, `accounts/`, `checkout/`, `visa/` | Cart persistence, identity, MFA, and sandbox transactions |
| `backend/config/` | Django settings and routing |
| `shared/` | Room manifests, spatial metadata, furniture models, and asset credits |
| `scripts/` | Local launcher, asset preparation, validation, and release utilities |
| `room_mesh/` | Standalone experimental phone-video reconstruction pipeline |
| `docs/`, `INDEX.md` | Feature guides, architecture, setup notes, and documentation index |

The development frontend proxies `/api` and `/_allauth` requests to Django. Production needs equivalent routing; Vite’s development proxy is not included in the build. The repository includes separate frontend and backend Vercel configurations; follow the [deployment guide](docs/frontend/room-cart-deployment.md) for environment settings, migrations, and paired release verification.

## Prototype boundaries

- **Geometry depends on calibration.** Placement checks use supplied spatial metadata and dimensions. A visually convincing scan does not establish measured accuracy, and demo rooms may use assumed scale.
- **The bedroom demo uses a fixed $1,200 budget.** Its three designs each contain five pieces. Some catalogue prices are synthetic; totals do not establish real retail pricing. Visa sandbox responses are not real purchases, merchant orders, or settlement.
- **Asset and browser support matter.** Large rooms can require a substantial initial download; voice and rendering behavior depend on the device and browser. Agent screenshot requests need an open editor.
- **Room reconstruction is experimental.** The separate phone-video pipeline is not an integrated upload-to-room service. Automatic floor-plan ingestion described in the original proposal is not part of the current application workflow.

For more detail, start with the [documentation index](INDEX.md), [scene designer guide](docs/backend/scene-designer/README.md), or [account and checkout guide](docs/account-mfa-checkout.md).
