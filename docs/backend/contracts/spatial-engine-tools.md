# Spatial engine tools: placement results and screenshots

Updated on `codex/gaussian-splatting`, 2026-09-19. This extends the [scene API](scene-api.md). All poses are centimeters (`xCm`, `zCm`) plus `yawRad`; furniture pivots are footprint center at floor level. Use the current scene's product and instance IDs.

## Agent integration

`backend/api/engine_tools.py` exposes SDK-independent functions. Bind the Django session from the user's originating request in a trusted adapter. Do not expose `session_key` as a model argument or allow the model to choose another room's session.

```python
from api.engine_tools import try_place, request_scene_capture, read_scene_capture

result = try_place(
    session_key,  # supplied by trusted request adapter
    instance={
        "instanceId": "sofa-1",
        "productId": "test-sofa",
        "pose": {"xCm": 230, "zCm": 175, "yawRad": 0},
    },
    base_revision=current_revision,
    command_id="turn-42-place-1",
)
if result["ok"]:
    capture = request_scene_capture(
        session_key,
        base_revision=result["revision"],
        request_id="turn-42-view-1",
        view="perspective",  # or "top"
        camera={"azimuthDeg": 37, "elevationDeg": 35},  # omit for defaults
    )
    # Return pending to the caller, or poll asynchronously with bounded waits.
    # Do not block a synchronous Django request indefinitely.
    if capture["ok"]:
        image = read_scene_capture(session_key, capture["captureId"], include_image=True)
        # When image["status"] == "ready", imageDataUrl contains the real PNG.
        # Pass it as an image input through the team's agent SDK adapter.
else:
    reason = result["error"]["message"]
    details = result["error"].get("details", {})
```

Functions return `ok: false` with a machine-readable error and explanatory message for expected validation/storage failures. `read_scene_capture` returns `ok: true` while pending/rendering; that is not image completion. Failed captures return `ok: false`. The ready result includes dimensions, view, camera, revision, `modelWarnings`, and a session-protected `imageUrl`; `include_image=True` adds the PNG data URL. The image URL alone cannot be fetched by a remote model without the browser session. The team's SDK adapter must supply the actual image bytes/data URL as image content, not paste a URL into a text-only tool response.

## Prepared Studio 11 room

All HTTP paths below accept `?roomId=studio-11`; without it they use the legacy empty `demo-room`. All three Python adapters accept `room_id="studio-11"`. Always use the same room for placement, capture creation and polling. Room ID selects a known prepared fixture; it does not grant access to another session.

```python
result = try_place(
    session_key,
    instance={"instanceId": "chair-1", "productId": "test-chair",
              "pose": {"xCm": 300, "zCm": 420, "yawRad": 0}},
    base_revision=current_revision, command_id="scan-place-1",
    room_id="studio-11",
)
if result["ok"]:
    image_job = request_scene_capture(
        session_key, base_revision=result["revision"], request_id="scan-view-1",
        room_id="studio-11", view="perspective",
        camera={"kind": "firstPerson", "xCm": 330, "yCm": 160, "zCm": 510,
                "yawRad": 0.42, "pitchRad": -0.13, "fovDeg": 60},
    )
    plan_job = request_scene_capture(
        session_key, base_revision=result["revision"], request_id="scan-plan-1",
        room_id="studio-11", view="top", representation="spatial_plan",
    )
```

Omit the first-person camera to use the manifest default. Coordinates are centimeters, orientation is radians; pitch must be strictly between −π/2 and π/2 and FOV 30–100°. Camera height must be inside the room, and its 40 × 40 cm floor footprint must stay on reviewed floor outside fixed obstacles. Legacy orbit angles are rejected for scanned rooms with `unsupported_camera`.

A scanned top capture requires `representation: "spatial_plan"` and no camera. It is a labeled schematic of reviewed/unknown floor, fixed obstacles and added furniture, **not a photographic cutaway**. Omitting the representation returns `capture_representation_required`. Perspective uses `photographic`. Capture metadata includes `roomId`, `geometryRevision` and `representation`; workers render only matching prepared geometry. The renderer temporarily uses one camera/device for the frozen capture and restores the live camera and contents afterward.

Prepared placement adds these issue codes:

| Issue | Meaning |
| --- | --- |
| `fixed_obstacle` | Footprint overlaps fixed scanned furniture; `obstacleIds` identify the annotation |
| `unknown_area` | Some part of the footprint lies outside reviewed floor, including internal holes |
| `scale_unconfirmed` | Scale has not been accepted for placement |
| `geometry_conflict` (409) | Existing layout belongs to another immutable geometry revision |

Successful `validation.assurance` is `synthetic_demo` for this fixture. Its units and surface annotations are approximate test assumptions, not verified physical fit. The generated surface mesh is a diagnostic reference; the reviewed floor/obstacle fixture is authoritative.

## Try a placement

`POST /api/scene/placement/`:

```json
{
  "baseRevision": 4,
  "commandId": "turn-42-place-1",
  "instance": {
    "instanceId": "sofa-1",
    "productId": "test-sofa",
    "pose": {"xCm": 230, "zCm": 175, "yawRad": 0}
  },
  "dryRun": false
}
```

A new instance ID adds an object; an existing ID moves/rotates that object. Changing an existing object's product is rejected. The supplied coordinates are exact: agent placement never silently snaps or searches for a different location.

Success returns `ok: true`, `applied`, `validation: {valid: true, issues: []}`, and the complete persisted scene snapshot with its revision. `applied: false` means a valid dry run or an unchanged pose, not failure. A dry run validates against the current scene but does not save, increment its revision, or consume a command ID; its returned snapshot is the existing scene, not the hypothetical layout. Dry-run validity can become stale, so an actual placement must still use revision checking.

Example collision response (HTTP 400):

```json
{
  "ok": false,
  "error": {
    "code": "placement",
    "message": "Overlaps Oak lounge chair.",
    "details": {
      "issues": [{
        "code": "overlap",
        "instanceId": "sofa-1",
        "conflictingInstanceIds": ["chair-1"]
      }]
    }
  }
}
```

| Error / issue | Meaning |
| --- | --- |
| `placement` / `out_of_bounds` | Rotated footprint crosses a room edge; details include attempted bounds and room bounds in cm |
| `placement` / `overlap` | Footprint intersects another piece; details identify the attempted object and first conflicting instance |
| `placement` / `too_tall` | Furniture exceeds room height; details include heights |
| `validation`, `invalid_instance` | Invalid shape, IDs, dimensions, product, or non-finite pose |
| `product_mismatch` | Existing instance cannot change product |
| `revision_conflict` (409) | Reload the current scene before trying a revised placement |
| `command_conflict` (409) | Command ID was already used with a different payload |
| `unavailable` (503) | Storage is busy; retry the same operation |

Failure leaves geometry and revision unchanged. Only the first placement violation is reported. Retries must preserve the command ID, base revision, and payload. A recorded success is replayed even after later scene changes; its revision identifies the historical operation, not necessarily the latest scene. Read the current snapshot before requesting a new image if the replayed revision is no longer current. Legacy batch commands remain supported by `/api/scene/commands/`.

## Request a screenshot

`POST /api/scene/captures/`:

```json
{
  "requestId": "turn-42-view-1",
  "baseRevision": 5,
  "view": "perspective",
  "camera": {"azimuthDeg": 120, "elevationDeg": 40},
  "width": 1024,
  "height": 768
}
```

For the legacy room, use `"view": "top"` and omit `camera`. For default 3D omit `camera`; defaults are azimuth 37° and elevation 35°. Azimuth 0° places the camera toward +Z looking toward room center; +90° places it toward +X. Allowed azimuth −360° to 360°, elevation 10° to 85°. Distance automatically fits the complete room. Top view is orthographic, north/up is −Z, right is +X, and walls are hidden. Perspective walls cut away when they obstruct the view from behind. The legacy editor camera is never moved; the PlayCanvas worker temporarily reuses and then restores its camera.

The server freezes the full scene at `baseRevision` and responds 202 with `captureId`, status, revision, camera, view, and dimensions. Later edits cannot alter that snapshot. One request produces one view; request both views separately with distinct request IDs and the same current revision when both are needed. Reusing the same request ID/options returns the existing job; different options produce 409.

Poll `GET /api/scene/captures/<captureId>/`:

- `pending`: waiting for an open editor in the same session.
- `rendering`: a browser has leased the job.
- `ready`: `imageUrl` points to `GET /api/scene/captures/<captureId>/image/` (PNG).
- `failed`: `error.code` and `error.message` explain the failure.

The editor must remain open in the originating session. This MVP uses the real browser renderer, not a headless server render farm. Requests expire after 120 seconds, reporting `capture_timeout` when no browser finishes. The rendering worker reports model/render timeout after 15 seconds, context/render errors, or oversize image failures. Missing GLBs may render known dimensioned proxies, always disclosed in `modelWarnings`. Screenshots do not certify geometric placement; the deterministic placement result does.

## Worker, limits, and operations

The browser uses CSRF-protected `POST /api/scene/captures/claim/` with `{}` to claim one snapshot. A 30-second lease prevents multiple tabs from completing the same work. Complete through `POST /api/scene/captures/<captureId>/complete/` with `{leaseToken, imageDataUrl, modelWarnings}` or `{leaseToken, error: {code, message}}`. Expired or different leases return 409. Claims never mutate the scene.

Default size is 1024 × 768; allowed dimensions are 256–1536 each, at most 1.8 million pixels. PNG uploads are capped at **1.5 MiB** to fit Django's default request-body limit after base64 encoding. Oversized renders fail explicitly; retry with smaller dimensions. Server checks PNG signature, chunk CRCs, dimensions, data/end chunks, and encoded size. Four unfinished requests per session; retain the latest 20 completed jobs. Capture links are temporary session artifacts and may return 404 after pruning.

Migrate before running: `backend/.venv/bin/python backend/manage.py migrate`. Migrations 0002/0003 create captures and completion timestamps; 0004 adds prepared-room layout scoping and capture representation. Run the existing `./run-local.sh`; no new dependency or background service is required. The **Capture** button exercises this exact API and offers a PNG preview/download.

## Verification and limits

Backend tests cover dry-run/commit/no-op/failure, stale revisions, idempotency, conflict IDs, session isolation, CSRF, lease reclaim, timeout, limits, invalid PNGs, and trusted tool wrappers. Frontend tests cover camera framing across 5/10 cm scales, views/aspects/angles, and invalid capture jobs. Live browser verification is recorded in [editor implementation](../../frontend/editor-implementation.md).

Legacy geometry remains rectangular room bounds plus rotated furniture footprints and height. Prepared Studio 11 additionally uses reviewed floor-region coverage and fixed obstacle annotations. Door swings, walking clearances, arbitrary room polygons, and mesh-level collision are not implemented. Furniture production assets remain in the collaborator's separate `codex/realistic-couch-model` worktree; this change does not modify those assets.
