**FRIDAY - Furnish Rooms Intelligently. Design Around You.**

*HackMIT 2026 · Four people · 19-hour build*

Valid Space is a spatial shopping assistant that turns a floor plan into an interactive 3D room. Users browse furniture or speak to an AI agent that searches a catalogue, inspects product images, and places corresponding 3D models in their space. The platform highlights feasible placement regions and connects selected products to Visa sandbox checkout.

**The problem.** Furniture shopping separates product discovery from the space where products will be used. Shoppers must interpret dimensions, imagine arrangements, and track budgets across listings. An appealing sofa may obstruct a doorway or leave insufficient clearance. Valid Space brings these decisions into a single visual workflow.

**The user experience.**

1. **Construct the room.** Upload a floor plan to generate a room with floors, walls, and relevant openings. Confirm scale using known measurements and allow corrections through a manual room editor. A prepared room scan can provide visual context; structured geometry supplies the dimensions used for spatial checks.

2. **Browse or describe a goal.** Explore product cards and filters, or speak through Deepgram:

   > “Find a couch under $1,200 that matches this table and leaves three feet clear by the balcony.”

   The interpreted requirements appear as editable constraint chips.

3. **Search and inspect products.** The agent queries Elasticsearch for matching products, retrieves their prices and dimensions, and can inspect their 2D images. Each catalogue record references a separately stored 3D model. The MVP uses placeholder products with consistent metadata and assets.

4. **See where products fit.** Selecting a product highlights feasible placement regions on the floor. These regions depend on its dimensions, orientation, room boundaries, existing objects, and requested clearances. Users can drag, snap, rotate, replace, and undo placements.

5. **Refine through conversation.** Requests such as “rotate it,” “move it closer to the wall,” or “show something cheaper” trigger searches and scene edits. When a placement fails, the agent explains the conflicting constraint and proposes an alternative.

6. **Review and purchase.** The cart supports both **placed items**, associated with scene positions, and **unplaced items**, added directly from the catalogue. Users review the itemized total and explicitly approve a Visa sandbox checkout.

**The central interaction is the valid-space overlay.** Users can immediately see how changing a product, its orientation, or a constraint changes the available placements. Product search, spatial validation, and purchasing remain connected throughout the experience.

The initial solver checks floor-standing objects against room boundaries, overlaps, and explicit clearance zones. Its results depend on the supplied measurements and supported constraints. Budget filters are checked separately, while visual style remains a preference the agent helps evaluate.

**The agent architecture.** A Python agent built with the **OpenAI Agents SDK** runs behind the Django API. The SDK provides the application-controlled agent workflow; our application supplies its catalogue, geometry, scene, and cart tools. [OpenAI documentation](https://developers.openai.com/api/docs/guides/agents)

| Tool                             | Responsibility                                               |
| -------------------------------- | ------------------------------------------------------------ |
| Catalogue search and aggregation | Query Elasticsearch using validated filters                  |
| Product inspection               | Retrieve metadata, view product images, and locate 3D assets |
| Spatial calculation              | Compute feasible regions and validate placements             |
| Scene editing                    | Add, move, rotate, replace, and remove objects               |
| Scene screenshot                 | Give the agent visual feedback on the arrangement            |
| Cart preparation                 | Assemble selected products for user-approved checkout        |

The agent can make multiple tool calls to complete a request. Structured commands connect its decisions to the application. Geometry functions determine placement validity; screenshots support visual assessment. Fixed calculation tools are the starting point, with isolated code execution an optional extension.

**The implementation stack.**

| Layer               | Choice                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| Backend             | Python + Django API                                                          |
| Agent orchestration | OpenAI Agents SDK                                                            |
| Frontend            | JavaScript; framework and 3D library being finalized                         |
| 3D candidate        | React Three Fiber + drei if React is selected                                |
| Search              | Elasticsearch                                                                |
| Product assets      | Images and GLB models in static/object storage, referenced by catalogue URLs |
| Spatial engine      | Structured room geometry, placement checks, and a grid/mask overlay          |
| Voice               | Deepgram, with text input available                                          |
| Transactions        | Visa sandbox through a dedicated checkout interface                          |

Checkout will follow the supplied Visa integration’s authentication requirements. Application-level 2FA is separate from Visa transaction authorization. [Visa documentation](https://developer.visa.com/capabilities/visa-intelligent-commerce/overview)

**The four-person build plan.**

| Owner                         | Main responsibility                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| P1 — Space                    | Room construction, manual editor, spatial solver, overlay, and object manipulation         |
| P2 — Catalogue and agent      | Elasticsearch, agent orchestration, product inspection, and scene commands; then assist P1 |
| P3 — Experience               | App shell, catalogue, constraint chips, conversation controls, and visual polish           |
| P4 — Commerce and integration | Cart, approval flow, Visa sandbox, and end-to-end integration                              |

The team will agree on shared data contracts early, establish a deployed frontend-to-Django connection, and integrate a complete journey before final polish. Changes follow directory ownership and branch review.

**MVP scope.** One room, a small placeholder catalogue, voice/text requests, agent-assisted search and placement, a valid-space overlay, manual adjustments, and checkout. Full room-version comparison, live video reconstruction, and broad merchant ingestion are stretch work.

**Demo story.** A floor plan becomes a 3D room. The user requests a couch within a budget and with balcony clearance. The agent searches Elasticsearch and loads a matching model. The floor highlights feasible placements. A larger alternative fails the constraints, prompting an explanation and replacement. The user rotates the chosen couch, requests a cheaper option, adds an unplaced accessory, and approves the itemized Visa sandbox checkout.
