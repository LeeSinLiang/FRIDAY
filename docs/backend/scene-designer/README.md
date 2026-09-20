# In-app scene designer

## Outcome and existing contracts

William requests a working FRIDAY in-app agent that inspects the current model and places or moves furniture relative to existing objects. Use the current catalogue sentence input and editor notices. Normal catalogue searches remain searches. Commands operate only on the current session and floor, use centimetres/radians and stable instance/product IDs, and preserve existing undo, retries, floor isolation and cart/checkout locks.

The catalogue compiler remains a search/constraint compiler, now supplied with current scene references when the editor provides a room and revision. The separate scene designer calls existing `scene_service` validation/atomic commands and the browser capture queue. The [earlier Blender MCP handoff](../contracts/blender-mcp-agent-handoff.md) already identifies these gaps.

## Tools and execution

- Inspect the actual room/floor and every placed object; detailed lookup returns authoritative dimensions, transforms and rotated bounds. Resolve ambiguous names by asking; never guess an instance ID. Selection is passed from the editor and checked against this scene.
- Search existing model-backed catalogue products. The server owns dimensions and asset references; the model cannot change them.
- Calculate relative placement beside/in front of/behind a referenced instance, with an explicit room/reference/view frame and edge clearance. Validate against all placed furniture and the reviewed floor, including holes and fixed geometry. Also support explicit validated floor poses and moving/removing existing objects.
- Stage edits in memory, then commit the accepted batch atomically against its original revision. Repeated request IDs reuse the result. A stale scene returns a conflict. No purchase or checkout call is exposed.
- Supply real perspective and top PNGs before planning. The model can request target-focused or staged-preview views. Projected object ID boxes ground references; occlusion remains explicitly unknown. Before commit, require a staged preview of the exact proposed layout and a second model acceptance; revised layouts receive a fresh preview. Capture the accepted revision for a final visual review. Report saved geometry and visual review separately.
- Measure rotated footprint edge clearance and 3D bounding-prism distances using authoritative dimensions. Fixed obstacles without heights return unavailable vertical measurements. Scene inspection includes complete free regions, outline holes, source-to-floor transform and verified catalogue materials; it never invents window, cavity or mesh-material metadata.

Floor placement and reviewed support targets are supported. `place_supported` accepts a stable parent/target reference, profile revision, on/inside relation and parent-local X/Z/yaw. The shared support engine derives Y, checks full rotated bounds and compartment headroom, and tests solid panel collisions. Parent moves/rotations carry children; deleting a loaded parent is refused. Undo removes children first and restores parents first. Unknown tabletop/cavity geometry, nested attachments, closed-door insertion and architectural mesh editing remain unsupported.

`shared/placement-profiles.json` contains reviewed targets, collision proxies and source model hashes. PC-workspace assets are CC0 Kenney models at authored demo dimensions, explicitly marked generic visual proxies rather than retail-product matches. The desk has a conservative filled collision envelope; the authored open cabinet has separate solid panel boxes. A support target is a reviewed region, not an automatically inferred mesh feature. Frozen capture workers resolve attachments before rendering, and projection metadata reports actual elevated bounds.

## Resumable HTTP execution

`POST /api/designer/?roomId=...` accepts `{text, requestId, baseRevision, selectedId?, camera?}` and returns a scoped job ID. `POST /api/designer/<id>/?roomId=...` advances one bounded step. Status is `running`, `completed` (accepted scene plus designer report), or `failed`. The model is Astra xhigh. Typed Agents SDK tools supply strict schemas and execute locally; Responses background mode carries reasoning between short HTTP requests. No Python background process must outlive a Vercel invocation.

`SceneDesignJob` persists tool state, capture IDs, model continuation ID and a lease. Request IDs are idempotent. Model calls occur outside database transactions. Cart ownership is rechecked at every short write and at atomic commit. The dedicated endpoint avoids the existing scene middleware's request-long transaction. Scene GET exposes only its own active job for reload recovery; the original before-state preserves undo even after a save. A receipt recovers a worker interrupted immediately after commit.

Keep the room open while the browser renders captures. Local worktrees need distinct hostnames when they use different databases: cookies are shared across ports. This task uses `friday-designer.localhost:5234` with that hostname in `DJANGO_ALLOWED_HOSTS`, leaving the owner's 5173/8000 stack alone.

The current user goal is support-aware placement: a monitor on a reviewed desktop and an object inside an explicit cabinet compartment, with stable references, derived height, parent movement/rotation, saved reload and undo/redo. Integrate the existing supported-placement implementation and real PC-workspace GLBs. The previously requested autonomous furnishing of all 34 floors is superseded and is not being pursued.

## Primary references

The [community Blender MCP tools](https://github.com/ahujasid/mcp-for-blender/blob/main/src/blender_mcp/server.py) separate scene/object inspection, edits and viewport images. Adopt that interaction loop using FRIDAY's own services. [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) supplies typed tool calls and application-returned results; local trusted context scopes access. [Responses background mode](https://developers.openai.com/api/docs/guides/background) supports asynchronous reasoning and polling. Existing installed SDKs are reused, with no additional transport/server dependency.

## Acceptance

Test duplicate names/IDs, rotation and exact edge clearance, self-exclusion during moves, fixed obstacles, holes, unknown references, cross-floor/session isolation, stale revisions, repeated requests, mixed-batch rollback, renderer capture failures and real image input. Replay a real in-app command that adds a GLB next to another GLB, move it by reference, reject a collision, and undo. Record tool trace, persisted revision, screenshot and live-model status in TODO_WILLIAM.md. Until those checks pass, this is implementation in progress.

## Integration status

The floor-relative live loop has passed placement, measured clearance, target/preview/after capture, collision refusal, reload during reasoning, undo and redo. The support implementation is integrated from the existing `codex/supported-placement` worktree without modifying that source checkout. Its earlier manual proof is in [supported placement verification](../../frontend/3d-object/supported-placement-verification.md). Live monitor/desk and cabinet acceptance passed locally and on the public skyscraper C32 floor in release `5afe392`; parent movement/rotation and undo/redo passed, with reload additionally checked locally. See [the public release evidence](../../demo/public-test-release.md) for exact checks, deployment identity and the cropped AI capture limitation.
