# FRIDAY system architecture

Source snapshot: 2026-09-20, current local working tree including concurrent, uncommitted work. Scoped with GPT-5.6 Luna and checked against source. This describes code structure, not a live deployment or end-to-end acceptance claim.

## Application runtime

```mermaid
flowchart TB
  User([Shopper])
  subgraph Browser["Browser · React 19 + TypeScript + Vite"]
    Shell["Entrance / room gallery / account / cart"]
    Editor["SplatEditor · active editor"]
    Render["PlayCanvas renderer<br/>Gaussian splat rooms + GLB furniture"]
    Spatial["Client spatial engine<br/>Placement masks, collisions, supports, drag / rotate"]
    Input["Catalogue + conversation<br/>Typed requests / microphone / wake detection"]
    Capture["Browser capture worker<br/>Revision-bound screenshots"]
    Legacy["Legacy editor<br/>React Three Fiber + Three.js"]
    Shell --> Editor
    Editor <--> Render
    Editor <--> Spatial
    Editor <--> Input
    Render --> Capture
    Shell -. "?legacy / ?testAssets" .-> Legacy
  end
  User --> Shell
  subgraph API["Django + Django REST Framework · session cookies + CSRF"]
    Scene["Scene API<br/>Revisions, commands, authoritative geometry validation"]
    Designer["Designer + variant jobs<br/>Resumable HTTP polling, staged edits"]
    Tools["Agents SDK tools<br/>Inspect / measure / search models / place / capture"]
    Captures["Capture requests + image storage"]
    Search["Search + language compiler<br/>Validated constraint DSL"]
    Voice["Transcription + speech endpoints"]
    Cart["Shopping sessions + cart<br/>Atomic design lock-in, guest-to-account transfer"]
    Auth["django-allauth<br/>Login, email verification, TOTP MFA, recovery"]
    Checkout["Checkout snapshot<br/>Explicit approval + MFA + sandbox submission"]
    Designer <--> Tools
    Tools --> Scene
    Tools <--> Captures
    Designer --> Scene
    Cart <--> Scene
    Cart --> Checkout
    Auth --> Checkout
  end
  Editor <-->|"Load / save / commands"| Scene
  Input <-->|"Design / refine / poll"| Designer
  Input <--> Search
  Input <--> Voice
  Capture <-->|"Claim job / upload PNG"| Captures
  Shell <--> Cart
  Shell <--> Auth
  Shell <--> Checkout
  subgraph Data["Persistence and assets"]
    DB[("Relational database<br/>SQLite locally; DATABASE_URL in production<br/>Scenes, jobs, captures, carts, accounts,<br/>approvals, receipts, DB cache")]
    Feed[("Local product catalogue<br/>Listings, prices, dimensions, model references")]
    Assets["Shared room + furniture assets<br/>GLB / splats / thumbnails / manifests / spatial JSON"]
    ES[("Elasticsearch<br/>Configured catalogue index")]
  end
  Scene --> DB
  Designer --> DB
  Captures --> DB
  Cart --> DB
  Auth --> DB
  Checkout --> DB
  Search --> ES
  Search -->|"Memory mode / failure fallback"| Feed
  Tools -->|"Local model catalogue"| Feed
  Designer -->|"Variant candidates"| Feed
  Feed -. "References" .-> Assets
  Assets --> Render
  Assets --> Spatial
  Assets -->|"Room and product metadata"| Scene
  subgraph External["External services · server-held credentials"]
    OpenAI["OpenAI<br/>Planning, structured language compilation, vision"]
    STT["Deepgram or OpenAI<br/>Speech to text"]
    TTS["Deepgram Athena<br/>Text to speech"]
    Email["Configured SMTP<br/>Verification and recovery email"]
    Visa["Visa IDX sandbox<br/>Signed / encrypted request; sandbox receipt"]
  end
  Designer <--> OpenAI
  Search <--> OpenAI
  Voice <--> STT
  Voice <--> TTS
  Auth --> Email
  Checkout <--> Visa
```

## Asset preparation and delivery

```mermaid
flowchart LR
  subgraph Offline["Offline preparation"]
    Scans["Room scans / authored meshes"] --> Prep["Room preparation scripts<br/>Convert, package, review spatial metadata"]
    Furniture["Furniture GLBs + product metadata"] --> Import["Import / fit / validate / thumbnail tools"]
    Video["Phone video"] --> Mesh["Standalone room_mesh experiment<br/>VGGT → TSDF → calibration → GLB exports"]
    Mesh -. "Separate output; manual integration" .-> Prep
    Prep --> Shared["shared/ rooms + models + metadata"]
    Import --> Shared
  end
  subgraph Delivery["Build and deployment"]
    Shared --> Vite["Vite asset packaging"]
    Vite --> FE["Vercel: friday-hackmit<br/>React bundle + packaged assets"]
    Shared -->|"Runtime JSON metadata"| BE["Vercel: friday-hackmit-api<br/>Django WSGI"]
    FE -->|"Same-origin API / auth rewrites"| BE
    Local["run-local.sh<br/>Vite proxy + Django development server"]
    Git["GitHub PR checks<br/>Backend tests + frontend tests + build"]
    Git -. "Documented manual paired release" .-> FE
    Git -. "API first; matching source identity" .-> BE
  end
```

## Boundaries that matter

- The active editor is PlayCanvas. Three.js/React Three Fiber remain behind explicit legacy/test routes and in supporting tooling.
- The browser owns rendering, interactive placement and screenshot generation. Python owns saved-scene authorization, revision checks and placement validation. Visual splats alone do not establish measured geometry: room spatial metadata and calibration determine what can be validated.
- Designer tools stage edits; the application validates and commits them. Resumable jobs live in the database and advance through HTTP polling and OpenAI background responses. This is not a Celery/Redis worker architecture.
- Browser capture jobs require an open editor. The backend does not run a hidden 3D renderer. The image-to-agent loop is capture request → browser PNG → backend → model.
- `/api/search` selects Elasticsearch or memory; Elasticsearch failures fall back to the local feed. The designer's `search_models` tool directly searches the local catalogue, so it should not be drawn as necessarily passing through Elasticsearch.
- Variant generation, wake voice and related paths are present in the working tree, including uncommitted changes. Their presence is not proof that the complete physical microphone, autonomous design or approved checkout workflow has passed live acceptance.
- Checkout uses immutable snapshots, explicit user approval and MFA. Visa IDX is a sandbox integration; it does not establish a real purchase, merchant order or settlement.
- Phone-video reconstruction is a standalone experimental pipeline, not an automatic production upload-to-room service. Floor-plan ingestion in the proposal should not be inferred as a completed runtime feature.
- Production deployment topology follows checked-in configuration and the deployment guide. The two Vercel projects require the documented paired manual release until automatic Git deployment is verified. No live deployment was inspected for this diagram.
- The local project-manager Kanban is developer tooling, not part of the shopper runtime.

## Source map

| Area | Primary source |
| --- | --- |
| Routes and active editor | `frontend/src/App.tsx`, `frontend/src/SplatEditor.tsx` |
| Renderer and interactive geometry | `frontend/src/scene/playcanvas/`, `frontend/src/scene/` |
| Browser screenshots | `frontend/src/scene/useCaptureWorker.ts`, `frontend/src/scene/playcanvas/capture.ts` |
| API routing | `backend/config/urls.py`, `backend/api/urls.py`, `backend/catalogue/urls.py` |
| Designer / vision / variants | `backend/api/designer_agent.py`, `designer_jobs.py`, `designer_variants.py`, `designer_vision.py` |
| Authoritative scene state | `backend/api/scene_service.py`, `designer_geometry.py`, `models.py` |
| Language / search / voice | `backend/catalogue/views.py`, `dsl/compile.py`, `es.py`, `memory.py`, `transcribe.py`, `speak.py` |
| Commerce and identity | `backend/shopping/`, `backend/accounts/`, `backend/checkout/`, `backend/visa/` |
| Database and cache | `backend/config/settings.py` |
| Assets / preparation | `shared/`, `scripts/gaussian_room/`, `scripts/`, `room_mesh/room_mesh/cli.py` |
| Local / production hosting | `run-local.sh`, `frontend/vite.config.ts`, `frontend/vercel.mjs`, `backend/vercel.json`, `docs/frontend/room-cart-deployment.md` |

Verification: inspected the listed routing, service, model and configuration boundaries. No application code was changed, runtime tests were required, or servers were started for this documentation task.
