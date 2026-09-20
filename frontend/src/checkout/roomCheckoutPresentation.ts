import type { Cart } from '../shopping/CartProvider'
import type { Checkout } from './types'
import type { CartLine } from './cartLines'

/** A film never substitutes for the server's verified sandbox response. */
export function sandboxDispatchVerified(checkout: Checkout | null): boolean {
  const evidence = checkout?.evidence
  return checkout?.state === 'accepted' && !!evidence
    && typeof evidence.http_status === 'number' && evidence.http_status >= 200 && evidence.http_status < 300
    && evidence.transaction_id_matches === true
    && typeof evidence.response?.idxMatchKey === 'string' && evidence.response.idxMatchKey.trim().length > 0
}

/** Once created, the immutable checkout snapshot is the authority for the consent screen. */
export function roomCheckoutLines(cart: Cart, checkout: Checkout | null, currentLines: CartLine[]) {
  if (checkout) return checkout.snapshot.items.map(line => ({
    id: line.product_id, name: line.name, quantity: line.quantity,
    thumbnail: cart.items.find(item => item.product_id === line.product_id)?.thumbnail ?? '',
    amount: line.priced !== false ? line.line_amount : null,
  }))
  return currentLines.map(line => ({id: line.productId, name: line.name,
    quantity: line.quantity, thumbnail: line.thumbnail,
    amount: line.priced ? line.unitAmount * line.quantity : null}))
}
