# Catalogue, search and language layer

Owner: Saketh. Status: contracts only — endpoints land next.

## What this is

Natural language compiles into a small constraint `Program`. `find[]` filters the catalogue
(Elasticsearch, with an in-memory fallback); `place[]` is handed to the floor solver as data.
This layer never does geometry.

## Where things live

| Path | Purpose |
| --- | --- |
| `backend/catalogue/types.py` | `Listing`, `SearchResponse` — validating definition (Pydantic) |
| `backend/catalogue/dsl/schema.py` | `Program`, 7 `FindClause` + 6 `PlaceClause`, `Ref` — validating definition |
| `frontend/src/lib/types.ts` | TypeScript mirror of `types.py` |
| `frontend/src/lib/dsl/schema.ts` | TypeScript mirror of `dsl/schema.py` |
| `backend/catalogue/tests.py` | Contract tests, no network |

The Python and TypeScript files are a pair: change both in the same commit.

## Rules

- **Units:** integer millimetres and integer cents everywhere. Convert only in the UI.
- **`dims_mm` is required** on every listing.
- **The DSL is closed at 13 clauses.** An unmappable phrase is dropped, never invented as a new clause.
- Solver invariants (inside the floor, no overlap, supported, door swing) are never clauses.
- Raw clause syntax is never shown to a user outside a dev page.

## Configuration

Keys are listed in `.env.example`: `ELASTIC_URL`, `ELASTIC_API_KEY`, `SEARCH_BACKEND`
(`memory` default, or `elastic`), `OPENAI_API_KEY`. The memory backend stays the default so the
demo works with Elasticsearch or the model unavailable.

## Checks

```bash
(cd backend && uv run python manage.py test catalogue)
(cd frontend && npm run build)
```
