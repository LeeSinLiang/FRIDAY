import { useEffect, useState } from 'react'
import { cartRequest, useCart } from './CartProvider'
import type { Checkout } from '../checkout/types'
import CartChoreography from '../checkout/CartChoreography'

export default function CartReady() {
  const {cart, refresh} = useCart()
  const [claimed, setClaimed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { let alive = true; cartRequest('claim/', 'POST', {}).then(async () => { await refresh(); if (alive) setClaimed(true) }).catch(e => { if (alive) setError(e.message) }); return () => {alive = false} }, [refresh, attempt])
  async function checkout() {
    if (!cart) return
    setBusy(true); setError('')
    try { const result = await cartRequest<Checkout>('checkout/', 'POST', {revision: cart.revision}); location.assign('/checkout?checkout=' + result.id) }
    catch (e) { setError((e as Error).message); await refresh(); setBusy(false) }
  }
  return <section className="auth-panel"><p className="eyebrow">Your account is ready</p><h1>Bring it all together.</h1><p>Your furniture and arrangement are connected to your account. Review your selection, then approve the sandbox checkout.</p>
    {!!cart?.items.length && cart.priced_count < cart.item_count && <p className="notice">{cart.priced_count ? `${cart.priced_count} of ${cart.item_count} pieces have a known price. Checkout covers those; the rest stay on the bill as price unavailable.` : 'Nothing in your cart has a known price yet, so there is nothing to check out.'}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {!claimed && error ? <button onClick={() => {setError(''); setAttempt(n => n + 1)}}>Reconnect your cart</button> : <button disabled={!claimed || busy || !cart?.items.length || !cart.priced_count || cart.items.some(i => !i.available)} onClick={() => void checkout()}>{busy ? 'Preparing your review…' : claimed ? 'Review checkout' : 'Connecting your cart…'}</button>}
    <a className="settings-link" href="/rooms">Keep exploring</a>
    {/* Under the action, never over it: the pieces gather while the button above is already live. Only on the cart
        itself: sign-in, the authenticator step and the checkout review never mount this component. */}
    {location.pathname === '/cart' && !!cart?.items.length && <CartChoreography items={cart.items} itemCount={cart.item_count} pricedCount={cart.priced_count} amount={cart.amount}/>}
  </section>
}
