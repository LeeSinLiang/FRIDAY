import { useState } from 'react'
import { useCart, cartRequest } from './CartProvider'
import { money } from '../checkout/types'

export default function CartSummary({editable = false}: {editable?: boolean}) {
  const {cart, refresh, error: loadError} = useCart()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const groups = new Map<string, NonNullable<typeof cart>['items']>()
  for (const item of cart?.items ?? []) groups.set(item.product_id, [...(groups.get(item.product_id) || []), item])
  async function remove(id: string) {
    if (!cart) return
    setBusy(true); setError('')
    try { await cartRequest('items/' + id + '/', 'DELETE', {revision: cart.revision}); await refresh() }
    catch (e) { setError((e as Error).message); await refresh() }
    finally { setBusy(false) }
  }
  return <section className="cart-summary" aria-label="Your furniture order">
    <p className="shop-kicker">Your arrangement</p><h2>Your cart <span>{cart?.items.length ?? 0}</span></h2>
    {groups.size ? <ul>{[...groups].map(([id, items]) => <li key={id}>
      {items[0].thumbnail && <img src={items[0].thumbnail} alt=""/>}<div><h3>{items[0].name}</h3><p>Quantity {items.length} · {money(items[0].unit_amount)} each</p>
      {!items[0].available && <p role="alert">Currently unavailable</p>}
      {editable && <button className="text-button" disabled={busy} onClick={() => void remove(items[items.length - 1].id)}>Remove {items.length > 1 ? 'one' : 'from cart'}</button>}</div><strong>{money(items.reduce((sum, i) => sum + i.unit_amount, 0))}</strong>
    </li>)}</ul> : <p>Your cart is waiting for its first piece. Confirm furniture in a room to add it here.</p>}
    <div className="cart-total"><span>Total · USD</span><strong>{money(cart?.amount ?? 0)}</strong></div>
    <p className="cart-note">Sandbox checkout. No charge or vendor order is placed.</p>
    {(error || loadError) && <p className="error" role="alert">{error || loadError}</p>}
    <a className="settings-link" href={cart?.items[0] ? '/room/' + cart.items[0].roomId : '/rooms'}>← Back to your room</a>
  </section>
}
