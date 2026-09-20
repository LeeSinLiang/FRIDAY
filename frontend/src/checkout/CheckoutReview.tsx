import { useEffect, useState } from 'react'
import { assertSuccess, request } from '../auth/api'
import CartReady from '../shopping/CartReady'
import ApprovalForm from './ApprovalForm'
import SandboxReceipt from './SandboxReceipt'
import { billLine, isPriced, money, vendorLine, type Checkout } from './types'

export default function CheckoutReview() {
  const id = new URLSearchParams(location.search).get('checkout')
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function load() {
    if (!id) return
    const result = await request(`/api/checkouts/${encodeURIComponent(id)}/`)
    assertSuccess(result); setCheckout(result.data)
  }
  useEffect(() => { void load().catch(e=>setError(e.message)) }, [id])
  async function submit() {
    if (!checkout || busy) return
    setBusy(true); setError('')
    try {
      const result = await request(`/api/checkouts/${checkout.id}/submit/`, 'POST', {snapshot_hash:checkout.snapshot_hash})
      assertSuccess(result); setCheckout(result.data)
    } catch (e) {
      setError((e as Error).message)
      await load().catch(()=>{})
    } finally {setBusy(false)}
  }
  if (!id) return <CartReady/>
  const lines = checkout?.snapshot.items ?? []
  const quantity = (wanted: boolean) => lines.filter(line => isPriced(line) === wanted).reduce((sum, line) => sum + line.quantity, 0)
  const counts = { items: checkout?.snapshot.item_count ?? quantity(true) + quantity(false), priced: checkout?.snapshot.priced_count ?? quantity(true) }
  return <section className="auth-panel checkout-panel">
    <p className="eyebrow">Visa sandbox</p><h1>Review your checkout</h1>
    <p className="muted">Your selected furniture, priced by the server. No real purchase or vendor order will be placed.</p>
    {checkout ? <>
      <p className="muted">Merchant of record · <strong>{checkout.snapshot.vendor.name}</strong></p>
      <ul className="checkout-items">{checkout.snapshot.items.map(item=><li key={item.product_id}><span>{item.name}<small>{item.vendor ? item.vendor.name + ' · ' : ''}Quantity {item.quantity}</small></span><strong>{isPriced(item) ? money(item.line_amount!) : 'price unavailable'}</strong></li>)}</ul>
      <p className="muted">{billLine(counts.items, counts.priced, checkout.snapshot.amount)}{vendorLine(lines) && <><br/>From {vendorLine(lines)}</>}</p>
      <p className="checkout-total"><span>{counts.priced < counts.items ? 'Total of priced items · USD' : 'Total · USD'}</span><strong>{money(checkout.snapshot.amount)}</strong></p>
      {checkout.state==='draft' && <ApprovalForm checkout={checkout} onApproved={setCheckout}/>}
      {checkout.state==='approved' && <><p className="notice">MFA approval recorded for this checkout.</p><button disabled={busy || !checkout.visa?.ready} onClick={()=>void submit()}>{busy?'Waiting for Visa…':'Send approved request to Visa sandbox'}</button></>}
      {checkout.state==='superseded' ? <p role="status">Your cart changed. Return to your cart for a new review and approval.</p> : !['draft','approved'].includes(checkout.state) && <SandboxReceipt checkout={checkout}/>}
      {['transport_unknown','submitting'].includes(checkout.state) && <button disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>Check stored status</button>}
      {!checkout.visa?.ready && ['draft','approved'].includes(checkout.state) && <p className="notice">Visa sandbox sending is unavailable until server credentials are configured.</p>}
    </> : !error && <p role="status">Loading saved checkout…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {!checkout && error && <button onClick={()=>void load().catch(e=>setError(e.message))}>Retry loading</button>}
    <a className="settings-link" href="/cart">Back to cart</a>
  </section>
}
