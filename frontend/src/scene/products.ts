import type { Instance, Product } from "./types";

const KINDS = new Set<Product["kind"]>(["sofa", "table", "chair"]);

/** Structural check for a product carried inline on an instance. The server is the authority on
 *  whether its dimensions are true; this only keeps malformed data out of editor state. */
export function validInlineProduct(value: unknown, productId: string): value is Product {
  if (!value || typeof value !== "object") return false;
  const product = value as Record<string, unknown>;
  return product.productId === productId && typeof product.name === "string" && !!product.name.trim() &&
    typeof product.color === "string" && KINDS.has(product.kind as Product["kind"]) &&
    (product.modelUrl === undefined || typeof product.modelUrl === "string") &&
    [product.widthCm, product.depthCm, product.heightCm].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
}

/** The product an instance refers to: the shared list first, then the one it carries. */
export const productOf = (instance: Instance, products: Product[]): Product | undefined =>
  products.find((p) => p.productId === instance.productId) ?? instance.product;

/** The shared list plus every product carried inline, so existing lookups by productId keep working. */
export function productsWith(products: Product[], instances: Instance[]): Product[] {
  const known = new Set(products.map((p) => p.productId)), extra: Product[] = [];
  for (const { product } of instances) {
    if (!product || known.has(product.productId)) continue;
    known.add(product.productId);
    extra.push(product);
  }
  return extra.length ? [...products, ...extra] : products;
}
