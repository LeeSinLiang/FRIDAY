import type { PlaceClause } from "../lib/dsl/schema";
import type { Product } from "../scene/types";
import { solve } from "./solve";
import type { Scene } from "./types";

self.onmessage = ({ data }: MessageEvent<{ scene: Scene; product: Product; place: PlaceClause[] }>) => {
  try {
    self.postMessage({ solution: solve(data.scene, { product: data.product }, data.place) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Fit calculation failed" });
  }
};
