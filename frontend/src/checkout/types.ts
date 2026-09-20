export type Product = { id: string; name: string; unit_amount: number }
export type Checkout = {
  visa?: {ready: boolean}
  id: string; state: string; snapshot_hash: string; expires_at: string; trans_id: string
  // A partial bill is honest, not a bug: a line whose price nobody knows has priced false and null amounts, never 0.
  snapshot: { vendor: { name: string }; items: BillLine[]; item_count?: number; priced_count?: number; amount: number; currency: string }
  evidence: { message?: string; http_status?: number; transaction_id_matches?: boolean; response_encrypted?: boolean; response?: { idxMatchKey: string; dcapIndicator?: number; warningMessages?: string[] } }
}
export type BillLine = { product_id: string; name: string; quantity: number; priced?: boolean; unit_amount?: number | null; line_amount: number | null }
export const isPriced = (line: { priced?: boolean; line_amount?: number | null }) => line.priced !== false && line.line_amount != null

/** "48 items · 31 priced · $12,480": the total covers what can be priced, and says so. All priced: "3 items · $1,623.99". */
export function billLine(items: number, priced: number, amount: number): string {
  const count = `${items.toLocaleString('en-US')} ${items === 1 ? 'item' : 'items'}`
  if (!priced) return `${count} · none priced yet`
  const total = money(amount).replace(/\.00$/, '')
  return priced < items ? `${count} · ${priced.toLocaleString('en-US')} priced · ${total}` : `${count} · ${total}`
}

export const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100)
