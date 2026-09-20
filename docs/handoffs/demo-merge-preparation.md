# Demo merge preparation

Status: owner will push. Prepare local commits only; do not push or merge remotely. Latest speech upgrade excluded; further verification deferred by owner.

## Current source and overlap

- Active checkout: `codex/locate-haussmann-room`, HEAD `58b0c7a`, with concurrent uncommitted app, documentation and asset work.
- Local `main`: `7d8bc1a`, owned by the furniture-batch worktree. It includes the first 17 GLBs via `33afdb1` and `782a585`. Do not check out or modify that worktree to merge app work.
- The current cached `origin/main` is older than local asset integration. No fetch was performed; it is not proof of current GitHub state.
- The active checkout already contains copies of those assets. Catalogue material strings differ from local main because active search uses normalized terms. Reconcile by listing ID and preserve current search behavior; do not wholesale replace the catalogue or duplicate IDs.
- Batch 2 was reported integrated: 169 listings, 131 thumbnail mappings, 139 asset folders, Elasticsearch 12169 documents with index_check AGREE. Backend integration now excludes five unsupported floor accessories and supports three distinct beds.

## Proposed review groups

1. Catalogue and realistic assets: models/metadata/thumbnails, listing and thumbnail registries, precise validation budgets and catalogue regression updates. Reconcile with existing local-main asset commits before choosing the merge base.
2. Natural design and first-variant presentation: intent/refinement/variant APIs, job routing, active-only draft frontend, sequential renderer completion and regression tests. The shared editor imports must land with their new modules.
3. Speech and room checkout integration: transcription/TTS, wake lifecycle and sensitive-code handling, atomic lock-in, immutable bill overlay, explicit consent/MFA, sandbox result film and tests. Shared editor and shelf hunks depend on groups 2 and 3; do not create a broken intermediate commit just to split files.
4. Final visual assets, documentation and synchronized work tracking, after the polish agent's stable handoff.

## Verification checkpoint

- Backend before batch-2 completion: `OPENAI_API_KEY= COMPILE_LIVE_TEST=0 .venv/bin/python manage.py test --noinput` → `Ran 429 tests in 17.637s / OK (skipped=4)`.
- Live AI routing: six initial intent cases and four checkout intent cases passed. Real refinement tests passed chocolate-sofa replacement, corner lamp placement and unknown-reference clarification without changing siblings or saved scene.
- Overlay lane: 20 focused voice tests and 9 checkout tests passed; production build completed in 2.64 s. Full combined frontend rerun is still pending final edits.
- Root caught that the exact confirmation “Yes, ready to pay” was rejected; controller owner fixed it and passed the focused regressions.
- `git diff --check` passed at preparation start. `.env`, `.runtime/visa-sandbox`, `backend/.runtime/mfa.key` and `.scratch` are ignored.

## Remaining release gates

- All active source/asset producers provide stable handoffs; inspect fresh diffs and explicit file lists, including untracked runtime modules and generated artwork.
- Run full unlabelled backend suite, `npm test`, and `npm run build` on the final combined source. Re-run the affected room workflow; tests alone do not prove animation or account transitions.
- Verify the user-visible panel exit, real-cart overlay and recovery states in the browser. The user owns acoustic STT testing. No test should submit a real sandbox request without explicit in-app consent and MFA.
- Review staged diff and secret/file-size checks before each commit. Each commit requires a concise subject and detailed body. Preserve unrelated collaborator work.
- Once the owner authorizes actual synchronization and merge, inspect fresh remote main at that task boundary, integrate in an isolated checkout, and run the full checks on the actual merged source. Do not push directly to main or rewrite published history. Attach any created PR to the task.
- Verify a feature-branch push against the remote ref. Deployment is a separate paired API/frontend release; a push or merge does not currently deploy FRIDAY.

Latest source checkpoints: design integration full backend `Ran 431 tests in 57.059s / OK (skipped=4)`; frontend `255 + 29 passed`, build `4.83s`. Subsequent Flux/configurable speech changes were backed out at owner request; preserve the prior OpenAI STT / Deepgram Athena TTS setup.
