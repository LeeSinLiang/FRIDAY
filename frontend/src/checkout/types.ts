export type Product = { id: string; name: string; unit_amount: number }
export type Checkout = {
  visa?: {ready: boolean}
  id: string; state: string; snapshot_hash: string; expires_at: string; trans_id: string
  // A partial bill is honest, not a bug: a line whose price nobody knows has priced false and null amounts, never 0.
  snapshot: { vendor: { name: string }; items: BillLine[]; item_count?: number; priced_count?: number; amount: number; currency: string }
  evidence: { message?: string; http_status?: number; transaction_id_matches?: boolean; response_encrypted?: boolean; response?: { idxMatchKey: string; dcapIndicator?: number; warningMessages?: string[] } }
}
export type Vendor = { id: string; name: string }
export type BillLine = { product_id: string; name: string; quantity: number; vendor?: Vendor | null; priced?: boolean; unit_amount?: number | null; line_amount: number | null }
export const isPriced = (line: { priced?: boolean; line_amount?: number | null }) => line.priced !== false && line.line_amount != null

/** "48 items · 31 priced · $12,480": the total covers what can be priced, and says so. All priced: "3 items · $1,623.99". */
export function billLine(items: number, priced: number, amount: number): string {
  const count = `${items.toLocaleString('en-US')} ${items === 1 ? 'item' : 'items'}`
  if (!priced) return `${count} · none priced yet`
  const total = money(amount).replace(/\.00$/, '')
  return priced < items ? `${count} · ${priced.toLocaleString('en-US')} priced · ${total}` : `${count} · ${total}`
}

/** "Amazon 46 · IKEA 2": who a bill's pieces come from, most pieces first. Not the merchant of record. */
export function vendorLine(lines: { vendor?: Vendor | null; quantity: number }[]): string {
  const counts = new Map<string, number>()
  for (const line of lines) if (line.vendor) counts.set(line.vendor.name, (counts.get(line.vendor.name) ?? 0) + line.quantity)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => `${name} ${count.toLocaleString('en-US')}`).join(' · ')
}

export const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100)
