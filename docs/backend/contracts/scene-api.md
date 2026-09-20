# Scene persistence and agent command contract

Implemented on `feat/3d-engine-frontend`, 2026-09-19. The browser and Django use `shared/scene-fixtures.json` for room dimensions and product metadata. Poses are centimeters plus radians; renderer scale is independent.

## Session and transport

`GET /api/scene/` initializes an empty, database-persisted room for the current Django session and sets session/CSRF cookies. Returns `{room, products, instances, revision}`. Room revision is metadata; the top-level revision controls edits. Send cookies and `X-CSRFToken` on every write. Vite preserves the original Host (`changeOrigin: false`) so Django can enforce same-origin checks through the development proxy. These are anonymous demo sessions, not user accounts or shareable room IDs. Losing the session cookie loses access to its room. Other REST endpoints retain their authentication defaults.

`PUT /api/scene/` accepts `{baseRevision, instances}` and returns the complete saved snapshot. Changed snapshots increment revision once; identical snapshots do not. Stale revisions return 409. The browser restores before editing, debounces saves by 400 ms, and polls clean scenes every two seconds. Local dirty state is never silently replaced. Conflicts stop autosaving and expose **Reload saved room**, which explicitly discards local changes. Network failures retain local edits with retry. Initial load failure requires retry before editing. Changes not yet saved are not durable across browser closure.

See [spatial engine tools](spatial-engine-tools.md) for explicit placement attempts, dry runs, and top/3D screenshots with agent-ready image data.

## Agent edits

`POST /api/scene/commands/` accepts this shape:

```json
{
  "baseRevision": 0,
  "commandId": "agent-turn-1",
  "commands": [
    {"type": "add", "instance": {"instanceId": "sofa-1", "productId": "test-sofa", "pose": {"xCm": 230, "zCm": 175, "yawRad": 0}}},
    {"type": "setPose", "instanceId": "sofa-1", "pose": {"xCm": 250, "zCm": 175, "yawRad": 0}}
  ]
}
```

Also supports `{type: "remove", instanceId}`. Success returns the full snapshot plus `commandId`. A batch is atomic: any invalid command rolls back everything. Each intermediate state must be valid, so move obstructing pieces away before moving into their positions. At most 100 commands and 100 instances. IDs are nonempty strings of at most 128 characters; products must be in the shared catalogue.

Retry an uncertain command with the exact same command ID, base revision, and payload. Its stored response is replayed even if the scene has changed afterward. Reusing an ID with a different payload returns 409. Read the latest snapshot before a new command; never install an old replay response over a newer scene.

Server-side agent tools can call `api.scene_service.apply_scene_commands(session_key, base_revision, command_id, commands)` and `save_scene(session_key, base_revision, instances)`. The trusted adapter must derive the session from the originating request, never from model-supplied arguments. The OpenAI/voice agent itself is a teammate integration; this change supplies its validated service and HTTP path. A clean browser picks up agent changes through polling and resets local undo history.

## Catalogue products (added by Saketh's lane, 2026-09-19)

An instance may carry its product inline, so a scene no longer depends on `shared/scene-fixtures.json` for everything it can hold. Additive: instances of the three fixture products look and behave exactly as before and must not carry one.

```json
{"type": "add", "instance": {
  "instanceId": "poang-1", "productId": "ikea-193.025.39",
  "product": {"productId": "ikea-193.025.39", "name": "POÄNG armchair", "widthCm": 68, "depthCm": 82, "heightCm": 100, "color": "#c9a77c", "kind": "chair"},
  "pose": {"xCm": 300, "zCm": 250, "yawRad": 0}}}
```

- `productId` must be a fixture id or a **catalogue listing id** (`GET /api/search`). Any other id is rejected.
- **The backend stays the authority.** It derives the same product from its own catalogue (`backend/api/catalogue_products.py`, the backend's only mm→cm crossing: `dims_mm / 10`) and rejects an instance whose carried width, depth or height differs by more than 0.05 cm, with issue code `product_mismatch` and the catalogue's dimensions. A client cannot shrink a sofa to make it fit. Validation, collision messages and snapshots all use the server's copy.
- **What is stored is the server's copy.** Every carried field is type-checked (non-empty text up to 512 characters, a scene `kind`, positive finite dimensions), and the persisted `product` is rebuilt from the catalogue, so name, colour, kind and model also come from the server. Anything saved is something the editor's snapshot parser will load back; a bad carried field cannot lock a session.
- `product` allows exactly `productId`, `name`, `widthCm`, `depthCm`, `heightCm`, `color`, `kind`, and optional `modelUrl`. `kind` is one of the scene's three; the catalogue's 12 categories fold onto them by silhouette.
- Snapshots list every catalogue product placed in the scene under `products`, after the fixtures, so consumers that look products up by id need no change. The carried `product` also round-trips on the instance through `PUT /api/scene/`.
- Frontend: `instanceFromListing(listing, instanceId, pose)` in `frontend/src/region/boundary.ts` builds such an instance; `productOf` and `productsWith` in `frontend/src/scene/products.ts` resolve it. `validatePlacement`, the edit reducer and `parseSceneSnapshot` accept it; a shared product always wins over a carried one.

## Room presets (added by Saketh's lane, 2026-09-19)

`shared/scene-fixtures.json` may list extra rooms under `rooms`, each `{label, room, instances}`. The `friday_room` cookie selects one; an absent, empty or unknown value means the default room, which behaves exactly as before. Each room has its own layout per session, stored under `<session key>:<room id>`, so switching rooms never drags furniture into walls, and every scene endpoint (snapshot, commands, placement, captures) follows the cookie because they all key off the same value. A preset's `instances` seed its layout once, on first use; after that the layout is the user's, including an empty one. Validation uses the selected room's dimensions. Snapshots never include the `rooms` map.

## Placement and failures

Both engines check rotated rectangular footprints using separating axes, room bounds, height, finite numbers, and known dimensions. Touching edges are allowed (1e-6 cm tolerance). This is conservative metadata geometry, not mesh collision, walking clearance, door swing, or a feasible-space overlay. New manual pieces find the nearest free grid slot; dragging previews green/red, and invalid drops restore the last committed pose.

Errors use `{error: {code, message}, revision?}` for scene validation and CSRF failures: 400 invalid input/placement, 403 CSRF, 409 stale revision or reused command ID, 503 busy storage. Generic framework errors such as malformed JSON may use DRF's standard error body. No partial mutation occurs on rejected requests.

## Operations and checks

Run `backend/.venv/bin/python backend/manage.py migrate` before starting the existing full-stack launcher. Migration `api/0001_initial.py` creates session layouts and command receipts. Deployment must include the root `shared/` directory alongside `backend/`.

Run `backend/.venv/bin/python backend/manage.py test api`, `npm --prefix frontend test`, and `npm --prefix frontend run build`. Backend tests cover CSRF, session isolation, persistence, revision checks, geometry, rollback, limits, and idempotency. Development `?testAssets=1` stays local so diagnostic products cannot enter the production catalogue.
