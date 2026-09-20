export type Product = { id: string; name: string; unit_amount: number }
export type Checkout = {
  visa?: {ready: boolean}
  id: string; state: string; snapshot_hash: string; expires_at: string; trans_id: string
  snapshot: { vendor: { name: string }; items: { product_id: string; name: string; quantity: number; line_amount: number }[]; amount: number; currency: string }
  evidence: { message?: string; http_status?: number; transaction_id_matches?: boolean; response_encrypted?: boolean; response?: { idxMatchKey: string; dcapIndicator?: number; warningMessages?: string[] } }
}
export const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100)
