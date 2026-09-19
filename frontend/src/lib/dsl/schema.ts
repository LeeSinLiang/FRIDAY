// The constraint DSL. Closed at 13 clauses. Mirrors backend/catalogue/dsl/schema.py,
// which is the validating definition — change both together.

import type { Category } from '../types';

export type Ref =
  | { kind: 'any_wall' }
  | { kind: 'wall'; id: string }
  | { kind: 'window'; id?: string }
  | { kind: 'door'; id?: string }
  | { kind: 'instance'; id: string };      // something already in the room

// ---- filters the CATALOGUE (7) ----
export type FindClause =
  | { k: 'text';        q: string }
  | { k: 'category';    value: Category }
  | { k: 'price_max';   cents: number }
  | { k: 'price_min';   cents: number }
  | { k: 'colour';      hex: string }
  | { k: 'material';    value: string }
  | { k: 'fits_w_max';  mm: number };

// ---- filters the FLOOR (6) ----  the solver consumes these
export type PlaceClause =
  | { k: 'near';          ref: Ref; mm?: number }
  | { k: 'against';       ref: Ref }
  | { k: 'distance_min';  ref: Ref; mm: number }
  | { k: 'clear';         ref: Ref; mm: number }
  | { k: 'on';            ref: Ref }
  | { k: 'not_blocking';  ref: Ref };

export type Program = {
  find: FindClause[];
  place: PlaceClause[];
  qty?: number;
};
