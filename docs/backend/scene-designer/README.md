# In-app scene designer

## Outcome and existing contracts

William requests a working FRIDAY in-app agent that inspects the current model and places or moves furniture relative to existing objects. Use the current catalogue sentence input and editor notices. Normal catalogue searches remain searches. Commands operate only on the current session and floor, use centimetres/radians and stable instance/product IDs, and preserve existing undo, retries, floor isolation and cart/checkout locks.

The catalogue compiler remains a search/constraint compiler, now supplied with current scene references when the editor provides a room and revision. The separate scene designer calls existing `scene_service` validation/atomic commands and the browser capture queue. The [earlier Blender MCP handoff](../contracts/blender-mcp-agent-handoff.md) already identifies these gaps.

Speech and typing share the same conversational path. The original transcript goes unchanged to a model-based intent interpreter, which chooses room design, active-draft refinement, explicit selection/checkout review, catalogue browsing, saved-scene editing, or clarification. There are no required command phrases. For example, “with a $1,200 budget, help me plan my room; I want a couch beside the bed” can request three bedroom drafts without saying “design” or “bedroom”. Downstream geometry, price, revision and checkout consent checks still apply.

For transcription, `STT_PROVIDER=openai` uses `gpt-transcribe` with the server-only `OPENAI_API_KEY`; `STT_PROVIDER=deepgram` uses the existing server key. The explicit provider setting takes precedence over legacy `TRANSCRIBE_BACKEND`. Voice replies retain the configured speech service. Provider/model names are not displayed in product UI. The exact words heard remain visible so users can correct recognition mistakes.

Hey Friday attempts to start when the room is ready, unless the user previously stopped it. Browser microphone permission and audio activation still apply; the interface reports the specific startup stage and offers an activation button when required. Silence stays local; captured utterances are transcribed online. Stop remembers the opt-out. Natural speech recognition and browser microphone access must be rehearsed on the presentation machine.

The first bedroom draft is revealed one real model at a time. Each reveal waits for model readiness and the existing materialization animation's completion; the three variation controls appear after the last piece settles. Drafts remain separate from the saved scene until explicit lock-in. See the [demo rehearsal](../../handoffs/haussmann-demo-rehearsal.md) for the complete sequence.

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

The spoken placement cue shipped in [PR #104](https://github.com/LeeSinLiang/hackmit2026/pull/104), merged into `main` at `eca482e`. A Deepgram transcription of a recorded desk-and-lamp request was submitted through the normal editor input; the agent saved the desk and attached lamp, then a later standalone cue submitted a previously entered chair request. An empty or repeated cue made no edit. The physical microphone button itself was not exercised in that replay. Fresh merged-main checks passed: 390 backend tests (five skipped), 203 scene/frontend tests plus 25 auth/cart tests, six board tests, and the Vercel-mode build. Production API `dpl_3jmSyPvTKAL6QXBWKZ1DYVkJEE7m` and frontend `dpl_ERjRMCZWJD3NNSpSf5DC4XMS2Fky` are Ready with matching runtime identity `29acfbf8658fa414e7c68cbd248b78285dc9c1f4f8151340dadd3b3bfce91c92`. The public empty-room editor loaded and the bare cue showed the no-edit message. The broader relative-layout agent task remains open.

The hosted microphone failure was repaired in [PR #107](https://github.com/LeeSinLiang/hackmit2026/pull/107) and by setting `TRANSCRIBE_BACKEND=deepgram` on the production API. An actual microphone-button replay, with recorded speech played through the Mac speakers, transcribed a desk request despite incidental surrounding speech; FRIDAY started the designer and saved a workstation desk at X305/Z205 on the empty-room floor. The floor-plan inspector showed its 180×90×75 cm footprint, the cart stayed at one item, and reload retained the desk. [Issue #106](https://github.com/LeeSinLiang/hackmit2026/issues/106) is closed with the acceptance evidence. After the gallery merge `a4e56b8`, the latest production API `dpl_4eejX8sMx5xzXTzivoSsVFr4Dj4x` and frontend `dpl_71owZrHTi4rJkAP25iEXtTppYrKW` were refreshed together; direct API health, frontend rewrite and hosted DOM match source identity `448b665d98c1d134ce48ba70555a8f86413395b62df57d00133040144005bf0b187fbe3de8c52eee`. The entrance-to-room route and persisted desk were checked on that deployment. This proves the microphone path with the tested speaker-to-mic recording; wider agent-design acceptance remains open.

### Complete workstation acceptance

A multi-sentence request beginning “Design a complete workstation here” was initially
reduced to its final chair sentence by the client action router. Recognizing `design`,
`build` and `create` as scene verbs retains the whole request through the existing
in-app designer path. The exact request is a regression in `designerIntent.test.ts`.

On the merged AI-sidebar main plus this fix, a single typed request for a desk,
display, keyboard, mouse, desk lamp and chair followed by “Do it now” ran through
the normal empty-room editor. The agent staged twelve geometry-validated commands,
reviewed its preview, saved scene revision 1, then reviewed the accepted capture.
The saved scene has six objects: desk X300/Z280; display, keyboard, mouse and
Ravenna desk lamp attached to its reviewed top at Y75; and Rivet office chair
X300/Z172.3 on the floor. Server `validate_instances` accepted all six.
The overhead browser view showed the layout before and after reload; the cart
stayed at zero. The first-person camera puts the monitor in front of the keyboard
and chair, so their visual check uses the overhead view and saved geometry.
Screenshots are in `.scratch/desk-workflow/` in the test worktree. This replay used
the typed input; the earlier production microphone replay above verifies that
microphone transcripts enter the same routing path for a simpler desk request.

### Main release and verification limit

[PR #112](https://github.com/LeeSinLiang/hackmit2026/pull/112) merged the workstation
request routing fix at `b0d1d23` after backend, frontend and security CI passed.
Fresh merged-main checks passed: 393 backend tests (five skipped), 209
scene/catalogue and 25 account frontend tests, six board tests, and the Vite build.
The current production API `dpl_HvYCBrT4hFwdJcFMpQscDbsdL9Y1` and frontend
`dpl_9xMzd9Ld3AEPaQW4YxGecohvLVE5` are Ready. Direct and rewritten health,
the London room, and the hosted build markers matched source identity
`54a2843573981ddff8b373bd422bf9ee52dadebc2eb9323d2781e945ea4cfa5c`.
Elastic model search was active.

The full six-object action was not repeated on the public stable hostname:
its existing guest scene/cart would have been modified. An isolated immutable
deployment hostname returned a CSRF retry because that hostname is outside
the frontend's trusted origin. The six-object save and reload evidence above
comes from the local merged-source browser test. The earlier production
microphone-button replay verifies a simpler desk placement, not this complete
workstation request. Keep the Agent Harness acceptance card open.
