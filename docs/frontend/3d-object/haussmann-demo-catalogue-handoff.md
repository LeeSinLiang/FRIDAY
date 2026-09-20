# Model-agent handoff: all 15 warm Japandi GLBs

2026-09-20 · Decision owner: Sin · Target: Haussmann apartment, three autonomous bedroom designs, $1200 synthetic budget, Visa IDX sandbox.

The user explicitly clarified: **keep all 15 new GLB models in the catalogue, alongside the existing furniture.** This supersedes the initial six-piece shortlist. This document authorizes the integration scope; it does not claim the external worktree assets have been inspected or merged here.

## Answers 1–5

1. **Include all 15 new models.** Oak wardrobe, three-drawer dresser, nightstand, round pedestal table, rattan chair, oak bench, linen armchair, boucle pouf, slim console, paper floor lamp, ceramic table lamp, flatweave rug, open bookcase, sideboard/TV unit, and fiddle-leaf fig. Integrate the 12 verified assets first if the remaining three are still generating; deliver those three as a small follow-up. Do not make the main demo wait for all 15 to land. Test in `haussmann-apartment`, through `/room/haussmann-apartment`.
2. **Synthetic `stub` listings and invented demo prices are approved.** Use generic product names and `matchType: generic_visual_proxy`; do not bind these to IKEA, Amazon, or other real SKUs. Use one canonical integer-cent price per listing across search, agent budgets, cart, and checkout. Display “Demo catalogue · simulated prices.” Visa sandbox is sufficient. Existing cart checkout resolves catalogue products; do not extend the legacy two-item checkout fixture map as the integration strategy.
3. **The missing priority is a sofa in cream and warm brown.** None of the 15 is a couch; an armchair does not substitute for this requirement. Reuse the existing oak bed. Supply two matching generic sofa variants with real GLBs/textures, equal dimensions/pivot and equal demo price, so “more brownish” is an unmistakable visible change without moving the bed. Prefer two texture/material variants of one approved mesh over another generation job. If two meshes are used, measure both and revalidate placement; never lie about dimensions to make them match. This is additive to the 15, not a reason to remove any. Asset creation can run alongside integration.
4. **Make all 15 searchable, placeable catalogue listings. Do not pre-place them as Haussmann scene fixtures.** The agent must visibly furnish an initially empty editable scene. The current catalogue-to-scene adapter supplies scene products; no duplicate `shared/scene-fixtures.json` entries are required. Leave the room's static scan and geometry alone. A separate isolated test fixture may be useful, but do not seed every room or overwrite saved guest rooms.
5. **Approximately 40 MB is acceptable for this demo; keep 1024px textures.** Do not spend the deadline reducing everything to 512px. Keep individual GLBs within the existing 5 MiB gate. Retain the global 30,000 triangle cap; permit named exact-count exceptions for these marginal overages, with the measured count and reason in each asset's metadata. No blanket increase to 31,280. Only active design models should be needed in the viewport; verify the actual load rather than assuming all catalogue assets load eagerly.

## Approved synthetic price sheet

These are proposed canonical demo values, not market prices. Apply through the single catalogue source of truth. Preserve the actual existing asset IDs; the model agent should report their exact mapping rather than renaming folders for this document.

| New model | Catalogue category | USD | price_cents |
| --- | --- | ---: | ---: |
| Oak wardrobe | storage | 249 | 24900 |
| Three-drawer dresser | storage | 129 | 12900 |
| Nightstand | storage | 59 | 5900 |
| Round pedestal table | table | 199 | 19900 |
| Rattan chair | chair | 69 | 6900 |
| Oak bench | chair | 99 | 9900 |
| Linen armchair | armchair | 149 | 14900 |
| Boucle pouf | chair | 59 | 5900 |
| Slim console | table | 119 | 11900 |
| Paper floor lamp | lamp | 79 | 7900 |
| Ceramic table lamp | lamp | 39 | 3900 |
| Flatweave rug | rug | 89 | 8900 |
| Open bookcase | shelf | 159 | 15900 |
| Sideboard / TV unit | storage | 179 | 17900 |
| Fiddle-leaf fig | plant | 49 | 4900 |

Additional hero products: existing synthetic oak bed `demo-oak-platform-bed` → **39900 cents** (currently 89900; this is an intentional demo repricing); matching cream/brown generic sofas → **29900 cents each**. Confirm final IDs with the agent lane before wiring its allowlist. Never put invented prices on existing real-source ABO listings; use clearly synthetic identities and accurate provenance for any permitted reused asset.

The three bedroom designs may use different subsets and positions; catalogue inclusion does not mean all 15 are placed in each bedroom. Reference baskets:

- Bed + cream sofa + nightstand + paper floor lamp + pouf = **$895**.
- Bed + cream sofa + dresser + open bookcase + linen armchair = **$1135**.
- Bed + brown sofa + nightstand + dresser + open bookcase + pouf = **$1104**.

These are budget examples, not validated Haussmann placements. Actual agent layouts must differ and pass geometry checks. Swapping cream/brown at the same price preserves the budget. Prices are furniture subtotals; tax/shipping are outside this sandbox demo.

## Known defects: accept with accurate metadata

- **Rug:** retain it, declare its actual approximately 258 × 242 cm footprint, and describe it as near-square. Do not claim 200 × 300 or stretch it. Until the current overlap rules are verified, place only in clear floor space; do not automatically put furniture on top of it. Catalogue availability remains intact.
- **Pedestal table:** accept the reported approximately 10% flattening if actual measured anisotropy remains within the existing cap and the visual review is acceptable. Record it; do not refit past the cap or relax the test.
- **Bench:** use measured dimensions, including the extra depth and lower height. A generic listing describes the delivered object, not the original brief.
- **Seven marginal triangle overages:** add an exact named `TRIANGLE_BUDGET` entry for each measured asset over 30,000; do not invent counts. Pin measured totals and explain in `knownLimitations` that the delivered model was retained for demo visual quality/time.
- **Sideboard:** texture-only door divisions are acceptable; no opening-door interaction is promised.
- **Plant:** retain the conservative canopy footprint; do not shrink metadata to pot size while the validator uses the complete mesh bounds. Place it in a clear corner.
- **Table lamp:** retain as a catalogue asset. For placing it on a nightstand/dresser, use the existing attachment system with a reviewed support profile for that model. Do not claim automatic tabletop support merely because the lamp renders. Use the paper floor lamp in the critical demo until support is verified.

## Exact integration contract

For every model, preserve `shared/models/furniture/<actual-id>/{model.glb,thumbnail.png,metadata.json}`. GLB units are metres; +Y up; +Z front; bottom at Y=0; X/Z footprint centred. Metadata dimensions are centimetres; catalogue `dims_mm` are integer millimetres. Measure GLB X/Y/Z and map to width/height/depth correctly; do not swap height and depth.

1. **Metadata:** follow `shared/models/furniture/oak-platform-bed/metadata.json`. Include `productId`, model/thumbnail URLs, `widthCm/depthCm/heightCm`, `assetUnits`, axes, pivot, the exact `catalogueListingId`, `matchType`, generation/provenance, measured bytes/triangles/bounds, and known limitations. Use dimensions consistently rounded to millimetres: metadata cm must equal listing mm divided by ten. Keep any fit-scale/residual records consistent with the delivered file. These are generated generic objects, not verified retail reproductions.
2. **Listing:** append a unique synthetic item to `backend/catalogue/data/listings.json` with `source: "stub"`, generic title, supported category, integer `price_cents`, measured `dims_mm`, local `/models/furniture/<id>/model.glb`, `thumb_url`, colours and materials. Use existing `backend/catalogue/seed.py` palette values for search colour tags (cream `#e9e4d8`, oak `#c9a77c`, brown `#7a5235`/`#4a3626`); `catalogue.test_scale` checks exact agreement between hero colours and that palette. This constrains search tags, not the delivered texture pixels. Prefer `demo-<actual-id>` for new listing IDs. The folder/metadata product ID can differ from listing ID as in the oak bed; `catalogueListingId` must bind them precisely. Do not silently reuse an existing real product ID.
3. **Thumbnail registry:** append `/models/furniture/<id>/model.glb` → `/models/furniture/<id>/thumbnail.png` in `shared/catalogue-thumbnails.json`. Use an actual render of the delivered GLB, not the input turnaround. Preserve every existing mapping.
4. **Asset tests:** add only measured, named exceptions to `backend/api/test_furniture_assets.py`; retain all current entries and global limits. No blanket dimension or byte tolerance changes. Existing `frontend/scripts/shared-furniture-assets.ts` serves/packages these folders; verify it picks up the assets rather than duplicating them under `frontend/public`.
5. **Search/runtime refresh:** ingest the authoritative feed into the configured Elasticsearch index with `(cd backend && uv run python -m catalogue.ingest)`. Read its output and require zero failed documents; then run `(cd backend && uv run python -m catalogue.index_check)`. If the running search backend is memory-only, no Elasticsearch ingest is needed. The feed/catalogue/product lookup caches are process-local: restart the controlled API after changes. Do not restart the owner's existing stack without coordination. Verify one new ID and the brown alternative through the actual serving search backend, not just `load_listings()`.
6. **Documentation:** record final IDs, measured sizes, exact counts, exceptions and outstanding checks under `docs/frontend/3d-object/`; add the link to `INDEX.md`. Coordinate shared tracking edits with the integration coordinator instead of overwriting TODO/board files from the old worktree.

## Old-worktree merge boundary

The asset worktree started at `b5ecc73`. Deliver asset folders and narrowly scoped catalogue/thumbnail/test changes; do not replace current shared files with that old branch's copies. The integrator must re-read current main and reconcile by ID, preserving all teammates' newer rows, mappings and exceptions. Use a feature branch and reviewed patch/commit; do not push main, rebase published branches, or fetch mid-task. The user handles fetch. This handoff does not itself merge or deploy anything.

Model agent owns asset folders, its new listings, thumbnail rows, and exact test-budget entries. Backend agent owns variant design behavior; UI agent owns editor wiring; commerce agent owns selected-design cart handoff. Send final product IDs and measured dimensions to those lanes before integration. No need to alter renderer categories: the existing adapter maps catalogue categories to its limited proxy kinds while rendering the GLB.

## Verification and handback

Run the targeted asset test first, then the documented full checks on the integrated source:

```sh
(cd backend && OPENAI_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test api.test_furniture_assets catalogue.test_scale api.test_catalogue_placement) &&
(cd backend && OPENAI_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test) &&
(cd frontend && npm test) &&
(cd frontend && npm run build)
```

Quote actual output counts and failures. Run the user's launch path on private ports, for example `BACKEND_PORT=8241 FRONTEND_PORT=5241 ./run-local.sh`, and open `/room/haussmann-apartment`. Verify search → thumbnail → real GLB → valid placement → cart uses the same synthetic ID and price. Confirm the final cream/brown meshes and textures visually; do not count a title change as a color change. For placement, use a small off-centre target and a neighbouring invalid point to catch mirroring. Stop the private stack and check 8241/5241 are no longer listening.

Hand back exact included IDs (15/15 or honestly partial while three finish), asset bytes/counts, exceptions, test output, and actual-browser evidence. No external worktree binary was inspected during this planning pass; its reported verification remains the model agent's evidence until integrated and checked.
