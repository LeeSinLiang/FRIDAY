// What the cart choreography shows: the REAL cart, one line per product. No sample data: every name, thumbnail,
// quantity and price here comes from /api/cart/. Dependency-free on purpose, so node can run its tests directly.

export type CartPiece = { product_id: string; name: string; thumbnail: string; unit_amount: number; priced: boolean; vendor?: { name: string } | null }
export type CartLine = { productId: string; name: string; thumbnail: string; quantity: number; priced: boolean; unitAmount: number; vendor: string | null }

/** One line per product, in the order the pieces were added. */
export function cartLines(items: readonly CartPiece[]): CartLine[] {
  const lines = new Map<string, CartLine>()
  for (const item of items) {
    const line = lines.get(item.product_id)
    if (line) line.quantity += 1
    else lines.set(item.product_id, { productId: item.product_id, name: item.name, thumbnail: item.thumbnail, quantity: 1,
      priced: item.priced, unitAmount: item.unit_amount, vendor: item.vendor?.name ?? null })
  }
  return [...lines.values()]
}

/** The price as the cart prints it. A piece whose price nobody knows says so; it never reads $0. */
export function linePrice(line: CartLine, money: (cents: number) => string): string {
  if (!line.priced) return 'price unavailable'
  return line.quantity > 1 ? `${line.quantity} × ${money(line.unitAmount)}` : money(line.unitAmount)
}

/** A building's bill can run to hundreds of lines; the stage shows the first few and counts the rest. */
export function stageLines(lines: readonly CartLine[], max = 8): { shown: CartLine[]; more: number } {
  if (lines.length <= max) return { shown: [...lines], more: 0 }
  return { shown: lines.slice(0, max - 1), more: lines.length - (max - 1) }
}
