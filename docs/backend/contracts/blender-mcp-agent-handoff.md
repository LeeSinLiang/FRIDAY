# Saketh: Blender MCP-style agent scene context

Requested by William, 2026-09-19. Proposed recipient: Saketh, coordinating shared scene/UI contracts with Sin. Branch: `codex/visa-sandbox`; FRIDAY baseline: `98ca88d` plus the Visa/auth handoff. Kanban: `6ae44373-c5ee-44b4-867c-99e96937aef8`, **open**. This is a researched implementation handoff; no agent, editor, API or HTML tester code was changed.

## Requested outcome

Make the agent's scene access as similar to Blender MCP as our room-shopping application permits. It should discover the scene, inspect any individual object by a stable reference, obtain its location and metadata, perform an explicit operation, and inspect the updated geometry and image. A screenshot or an unstructured list of furniture names is insufficient.

Account for every upstream component family in the capability map below. Implement the room-relevant functions first; explicitly record unsupported Blender-specific operations. This is a design reference for the existing Django/Three.js/OpenAI Agents SDK architecture, not a requirement to replace it with Blender or add an MCP network service.

## Primary references and what they actually return

There are two different projects commonly called Blender MCP. Both were inspected at pinned source revisions on 2026-09-19:

| Reference | Use |
| --- | --- |
| [Official Blender Lab MCP: tool catalogue](https://projects.blender.org/lab/blender_mcp/src/commit/ff54e4d8f6b09502f2f466189cca0e52b4a91643/readme_tools.rst) | Primary coverage reference: 26 exposed tools at this revision. |
| [Official object hierarchy payload](https://projects.blender.org/lab/blender_mcp/src/commit/ff54e4d8f6b09502f2f466189cca0e52b4a91643/mcp/blmcp/tools/get_objects_summary_toolcode.py) | Scene/workspace/camera/active-object context and recursive collections. |
| [Official object detail payload](https://projects.blender.org/lab/blender_mcp/src/commit/ff54e4d8f6b09502f2f466189cca0e52b4a91643/mcp/blmcp/tools/get_object_detail_summary_toolcode.py) | Transforms, dimensions, hierarchy, materials, visibility, modifiers and constraints. |
| [Official tool wrapper](https://projects.blender.org/lab/blender_mcp/src/commit/ff54e4d8f6b09502f2f466189cca0e52b4a91643/mcp/blmcp/tools/get_object_detail_summary.py) and [transport response](https://projects.blender.org/lab/blender_mcp/src/commit/ff54e4d8f6b09502f2f466189cca0e52b4a91643/mcp/blmcp/tools_helpers/connection.py) | How the payload reaches the MCP tool result. |
| [Official image wrapper](https://projects.blender.org/lab/blender_mcp/src/commit/ff54e4d8f6b09502f2f466189cca0e52b4a91643/mcp/blmcp/tools/get_screenshot_of_window_as_image.py) | Actual PNG image content supplied to the model. |
| [Official code execution contract](https://projects.blender.org/lab/blender_mcp/src/commit/ff54e4d8f6b09502f2f466189cca0e52b4a91643/mcp/blmcp/tools/execute_blender_code.py) | Returned result dictionary and interactive/background distinction. |
| [Community MCP for Blender](https://github.com/ahujasid/mcp-for-blender/tree/6f992ffbca3cb715d111fc640b737b808632273c), formerly `ahujasid/blender-mcp` | Complementary example; distinct from the official project. |
| [Community scene/object payloads](https://github.com/ahujasid/mcp-for-blender/blob/6f992ffbca3cb715d111fc640b737b808632273c/addon.py#L984) and [world bounds/object detail](https://github.com/ahujasid/mcp-for-blender/blob/6f992ffbca3cb715d111fc640b737b808632273c/addon.py#L1341) | Compact summaries, mesh counts and world-space bounds. |
| [Community model-facing wrappers](https://github.com/ahujasid/mcp-for-blender/blob/6f992ffbca3cb715d111fc640b737b808632273c/src/blender_mcp/server.py#L455) | JSON serialized into text versus actual image results. |
| [MCP tool-result specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-result) | Distinguishes text, image, structured content and tool errors. |

Official sources were retrieved from the Blender project's API at commit `ff54e4d8f6b09502f2f466189cca0e52b4a91643`; the ordinary web reader could not open the project page. Community source is pinned to `6f992ffbca3cb715d111fc640b737b808632273c`. No Blender instance was launched or connected for this research; these are source-verified contracts, not a captured live Blender session.

### How information gets back to the model

**Official:** the model-facing tool has a name, description and argument schema. Its wrapper asks the Blender add-on to execute the corresponding query. `send_code` returns an outer dictionary containing `status`, `result` or `message`, and optional stdout/stderr. Object-query results themselves include a status field; a successful transport is not proof that the requested object exists. The wrapper returns that dictionary to FastMCP. Code-execution tools ask generated code to assign a JSON-serializable dictionary to `result`; non-strict execution can fall back to representations for unsupported values. The screenshot wrapper decodes the returned PNG and emits an `Image` object.

**Community:** `get_scene_info` and `get_object_info` serialize the add-on result into a JSON string returned as tool text. `get_viewport_screenshot` returns PNG image content. Its scene summary reports the total count but includes only the first ten objects, with rounded positions; detailed lookup is separate. FRIDAY should report pagination/truncation explicitly and retain precise positions for actual edits. Its object detail includes name/type, location, Euler rotation, scale, visibility, material names and mesh counts; mesh bounds are calculated in world coordinates. `obj.location` itself is not guaranteed to be a world position when parenting is involved.

**FRIDAY adaptation:** provide a small scene summary first and detailed JSON on demand. Pass screenshots as real image inputs using the agent SDK adapter. A session-protected image URL or base64 pasted into ordinary text does not give the remote model the pixels. If an MCP wrapper is added later, declare an output schema and use structured content plus compatible JSON text; keep the image as image content. Verify what reaches the model with a recorded tool-result trace.

## Complete upstream capability map

The official 26-tool inventory is grouped below; `_for_cli` means the corresponding separately exposed background-process variant.

| Official tools/components | FRIDAY equivalent or explicit disposition |
| --- | --- |
| `get_objects_summary`, `get_object_detail_summary` | Build scene summary and object inspection tools with stable IDs, hierarchy, placement and metadata. First priority. |
| `get_screenshot_of_window_as_json` | Expose active view, camera, selected IDs and visible objects when the frontend can supply them. Selection is not currently stored in the scene API. |
| `get_screenshot_of_window_as_image`, `get_screenshot_of_area_as_image` | Reuse scene captures; return image content and camera/revision metadata. A room capture is supported; arbitrary UI-area capture is a separate capability. |
| `execute_blender_code`, `execute_blender_code_for_cli` | Map scene edits to the existing validated placement/batch services. Arbitrary code execution and background Blender are not implemented; keep them explicitly unsupported unless separately designed. |
| `get_blendfile_summary_datablocks` and `_for_cli` | Scene/product/instance counts and asset types; expose FRIDAY's available data instead of inventing Blender datablocks. |
| `get_blendfile_summary_missing_files` and `_for_cli` | Missing model/texture URLs, load failures and dimensioned-proxy warnings. Report the state actually observed by the renderer. |
| `get_blendfile_summary_of_linked_libraries` and `_for_cli` | Asset source/dependency/provenance metadata where known. No `.blend` library support is implied. |
| `get_blendfile_summary_path_info` and `_for_cli` | Scene revision and persistence/synchronization status. No server filesystem paths or credentials in model results. |
| `get_blendfile_summary_usage_guess` and `_for_cli` | Optional room/use-case classification, clearly labelled inferred. Not required to inspect or place furniture. |
| `jump_to_tab_by_name`, `jump_to_tab_by_space_type` | Capability for switching supported FRIDAY panels/views, pending UI agreement. Do not claim Blender workspaces exist. |
| `jump_to_view3d_object_by_name`, `jump_to_view3d_object_data_by_name` | Focus/select by `instanceId` and resolve the product/model reference. Keep camera actions separate from geometry edits. |
| `render_thumbnail_to_path`, `render_viewport_to_path` | Reuse capture jobs for thumbnails/room previews and explicit export references. Current captures require an open browser in the originating session. |
| `get_python_api_docs`, `search_api_docs`, `search_manual_docs` | Supply the supported FRIDAY tool schemas, unit conventions and existing scene/catalogue contract docs. Blender API documentation is relevant only if Blender execution is later added. |

Community coverage adds these named tool groups. Include them in the capability inventory even when deferred:

- **Core:** `get_addon_status`, `get_scene_info`, `get_object_info`, `get_viewport_screenshot`, `execute_blender_code`, `describe_node_type`, `bpy_api_lookup`. Map status/inspection/image/edit/docs to the rows above; Blender node editing is unsupported.
- **Materials and assets:** `get_polyhaven_categories`, `search_polyhaven_assets`, `download_polyhaven_asset`, `set_texture`, `get_polyhaven_status`; `get_sketchfab_status`, `search_sketchfab_models`, `get_sketchfab_model_preview`, `download_sketchfab_model`; `get_polypizza_status`, `search_polypizza_models`, `download_polypizza_model`. Reuse the existing catalogue/model adapter first; external import/material operations need explicit provider support and asset provenance.
- **Generation:** `get_hyper3d_status`, `generate_hyper3d_model_via_text`, `generate_hyper3d_model_via_images`, `poll_rodin_job_status`, `import_generated_asset`; `get_hunyuan3d_status`, `generate_hunyuan3d_model`, `poll_hunyuan_job_status`, `import_generated_asset_hunyuan`. Keep generation, polling and import distinct. These providers are not FRIDAY features merely because the reference supports them.
- **Export and feedback:** `export_scene`, `record_trajectory_feedback`, `disable_telemetry`. An application trace can record requests, returned revisions and results. Provider telemetry or uploading user prompts/images is not needed for this adaptation; do not copy it as an implicit dependency.

## Object information contract to agree with Sin

Keep `instanceId` for the placed object and `productId` for the catalogue/model record. Multiple identical chairs need different instance IDs. Names are labels and may change; array order must never identify an object.

| Information | Required representation |
| --- | --- |
| Identity | Stable instance/product IDs, display name, kind/category, room reference, scene revision. |
| Localization | Stored `pose: {xCm, zCm, yawRad}`, coordinate frame, units, axis directions, floor pivot, resolved world position and orientation. FRIDAY is Y-up on an XZ floor; Blender commonly uses Z-up. Never copy coordinates without an explicit adapter. |
| Geometry | Authoritative width/depth/height in cm, rotated footprint, world AABB, and the collision representation/source. Distinguish original dimensions from rendered scale; catalogue mm converts to cm once. |
| Hierarchy | Parent, children and collections/groups if implemented; otherwise disclose that the MVP uses flat furniture instances. |
| Visual state | Asset reference/type (mesh/splat/proxy), model readiness/warnings, material/color metadata, visibility and selection when known. Mesh topology counts are meaningful only when available; a splat does not have mesh faces. |
| Shopping metadata | Server catalogue reference, integer price and explicit currency only if known, source/vendor distinction, stock status only when verified. Do not infer checkout readiness from a renderable object. |
| Provenance | Which values came from fixture/catalogue/renderer/calculation; unknown fields and unsupported operations explicit. A screenshot is not a measurement or stock check. |
| Spatial relationships | On-demand distances, collisions and relative locations with referenced IDs and stated geometry. Door/window clearance must remain unsupported until geometry for those features is implemented. |

Illustrative **proposed** object tool result, derived from the current `test-sofa` dimensions at a hypothetical pose; this is not an existing endpoint response:

```json
{
  "ok": true,
  "schemaVersion": 1,
  "revision": 7,
  "object": {
    "instanceId": "sofa-1",
    "productId": "test-sofa",
    "name": "Curve sofa",
    "kind": "sofa",
    "frame": {"space": "room", "upAxis": "+Y", "floorAxes": ["X", "Z"], "lengthUnit": "cm", "angleUnit": "rad", "pivot": "footprint-center-at-floor"},
    "pose": {"xCm": 230, "zCm": 175, "yawRad": 0},
    "worldPositionCm": {"x": 230, "y": 0, "z": 175},
    "dimensionsCm": {"width": 220, "depth": 95, "height": 74},
    "worldBoundsCm": {"min": {"x": 120, "y": 0, "z": 127.5}, "max": {"x": 340, "y": 74, "z": 222.5}},
    "color": "#b9542c",
    "geometrySource": "shared-scene-fixture",
    "collisionShape": "rotated-rectangle-plus-height",
    "parentInstanceId": null,
    "children": [],
    "unavailable": ["rendererSelection", "rendererVisibility", "materialNames", "meshTopology", "verifiedVendor", "stock", "checkoutPrice"]
  }
}
```

Do not add these extra fields to existing strict write payloads. Construct a separate read-only agent projection from the current snapshot and product metadata. Preserve the existing optional/null rules of the catalogue contract; this example is a new schema proposal, not a change to `Listing`.

## Development order and files to reference

1. **Agree the read contract.** Reuse `backend/api/scene_service.py` (`scene_for_session`, `serialize`) and `shared/scene-fixtures.json`. Define summary pagination, object lookup, units and error shapes; coordinate new UI-derived fields with Sin before changing shared files. Keep Saketh's existing catalogue/compiler behaviour intact.
2. **Implement inspection adapters.** Proposed tools: `get_scene_info`, `get_object_info(instanceId)`, and `get_capabilities`. Summary returns count, IDs, names, brief poses and revision; detail joins placement and known product/asset metadata. Expose all current objects through pagination; distinguish a product not placed in the room from an instance.
3. **Wire existing actions.** `backend/api/engine_tools.py` already supplies `try_place`, `request_scene_capture`, `read_scene_capture`; `scene_service.apply_scene_commands` supports atomic add/setPose/remove batches. Bind the user's session in trusted server code, never a model argument. Use current revision, exact pose, command ID, dry-run semantics and existing error details.
4. **Deliver images to the model.** Request a capture at the result revision, handle pending/rendering/ready/failed with bounded polling, then attach actual PNG content through the agent adapter. Include capture ID, camera, revision and warnings. `ok: true` with pending status means no finished image yet. The current browser renderer needs an open editor; stale images must not masquerade as current state.
5. **Connect the loop.** Scene summary → object detail → catalogue/geometry reasoning → placement dry run → apply against the current revision → fresh summary/detail → matching screenshot → explain the verified result. Re-read after revision conflicts and never guess nonexistent IDs or claim success after a failed edit. A user-facing conversational reference such as “that chair” must resolve to selection or ask for clarification when ambiguous.
6. **Expand by capability.** Asset/material lookup, focus/view actions and supported exports follow the core loop. Record unsupported code execution, generation, Blender-only metadata and missing geometry explicitly. Do not invent compatibility merely to fill the map.

References within FRIDAY: [scene API](scene-api.md), [placement and screenshot tools](spatial-engine-tools.md), [catalogue](../catalogue.md), [editor handoff](../../frontend/editor-implementation.md), and [Visa/auth integration boundaries](../../handoffs/visa-auth-integration.md). Coordinate additional agent implementation paths with the current owner rather than assuming a new architecture or changing the HTML tester.

## Acceptance checks for Saketh's implementation

- List every instance in a room containing more than ten objects; pagination and total count agree. Two instances of one product remain distinguishable through rename and movement.
- Object lookup returns current pose, dimensions, units/frame, provenance and revision. Missing/deleted IDs produce a useful error. Compare a 90-degree rotation's footprint/AABB with the deterministic geometry implementation.
- A centimetre/millimetre conversion and an explicit Blender-to-FRIDAY axis conversion fixture prevent scale/orientation mistakes. No conversion is performed when the data already uses FRIDAY units.
- Read summary → move a specific chair → read detail shows the same instance ID and new pose. Collision/out-of-bounds rejection leaves geometry and revision unchanged; stale revision and repeated command IDs obey the existing service contract.
- Actual tool traces show parseable metadata and an image content part containing the PNG, with matching revision. Exercise capture pending, renderer unavailable, timeout and model-proxy warnings.
- Session isolation holds; the model cannot select someone else's room or access authentication/Visa secrets. Unknown vendor/price/stock and absent material/mesh/selection data are labelled unavailable.
- Publish the tool names, schemas, capability matrix, one successful trace and one rejected-placement trace. Mark the Kanban card complete only after the real agent uses the adapters and the browser shows the corresponding result.

## Verification of this documentation handoff

Pinned source/tool definitions and current FRIDAY contracts were inspected; the proposed schema and component mapping were checked against them. Documentation links, JSON syntax and unchanged-code scope are checked before branch push. No live model/Blender integration was tested or claimed by this note; the existing five catalogue cache/test failures documented in the Visa handoff remain outside this documentation change.
