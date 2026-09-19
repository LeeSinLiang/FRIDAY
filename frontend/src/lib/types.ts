// Shared catalogue contract. Mirrors backend/catalogue/types.py — change both together.
// Units rule: INTEGER millimetres and INTEGER cents everywhere. Convert only at the UI edge.

export type Category =
  | 'sofa' | 'armchair' | 'chair' | 'table' | 'desk' | 'bed'
  | 'shelf' | 'storage' | 'rug' | 'lamp' | 'plant' | 'decor';

export type Listing = {
  id: string;
  source: 'ikea' | 'stub' | 'seed';
  title: string;
  category: Category;
  price_cents: number;                             // INTEGER cents. Never a float.
  dims_mm: { w: number; d: number; h: number };    // INTEGER mm. REQUIRED.
  model_url: string | null;                        // .glb, null for seed items
  thumb_url: string;
  colour_hex: string[];
  materials: string[];
};

export type SearchResponse = {
  items: Listing[];
  total: number;
  facets?: {
    category: { key: string; count: number }[];
    price_band: { key: string; count: number }[];
    fits_room?: number;          // count of items that fit the caller's constraint
  };
};
