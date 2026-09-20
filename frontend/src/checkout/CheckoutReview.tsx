import { useEffect, useState, type FormEvent } from 'react'
import { assertSuccess, request } from '../auth/api'
import ApprovalForm from './ApprovalForm'
import SandboxReceipt from './SandboxReceipt'
import { money, type Product, type Checkout } from './types'

export default function CheckoutReview() {
  const [products, setProducts] = useState<Product[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({ 'sample-sofa': 1 })
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const result = await request('/api/checkouts/catalogue/'); assertSuccess(result)
        if (!active) return
        setProducts(result.data.products); setReady(result.data.visa.ready)
        const id = new URLSearchParams(location.search).get('checkout')
        if (id) { const saved = await request(`/api/checkouts/${encodeURIComponent(id)}/`); assertSuccess(saved); if (active) setCheckout(saved.data) }
      } catch (error) { if (active) setError((error as Error).message) }
      finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [])

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const items = products.filter(product => quantities[product.id] > 0).map(product => ({ product_id: product.id, quantity: quantities[product.id] }))
      const result = await request('/api/checkouts/', 'POST', { items }); assertSuccess(result)
      setCheckout(result.data); history.replaceState({}, '', '/checkout?checkout=' + result.data.id)
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  async function submit() {
    if (!checkout) return
    setBusy(true); setError('')
    try {
      const result = await request(`/api/checkouts/${checkout.id}/submit/`, 'POST', { snapshot_hash: checkout.snapshot_hash })
      assertSuccess(result); setCheckout(result.data)
    } catch (error) {
      setError((error as Error).message)
      // A lost browser response does not prove a failed Visa request. Reload the saved state.
      const result = await request(`/api/checkouts/${checkout.id}/`).catch(() => null)
      if (result?.status === 200) setCheckout(result.data)
    } finally { setBusy(false) }
  }

  return <section className="auth-panel checkout-panel">
    <p className="eyebrow">Visa sandbox</p><h1>{checkout ? 'Review your checkout' : 'Choose a sample checkout'}</h1>
    <p className="muted">Sample furniture and test prices. No real purchase or vendor order will be placed.</p>
    {loading ? <p role="status">Loading checkout…</p> : checkout ? <>
      <p><strong>{checkout.snapshot.vendor.name}</strong></p>
      <ul className="checkout-items">{checkout.snapshot.items.map(item => <li key={item.product_id}><span>{item.name}<small>Quantity {item.quantity}</small></span><strong>{money(item.line_amount)}</strong></li>)}</ul>
      <p className="checkout-total"><span>Total · USD</span><strong>{money(checkout.snapshot.amount)}</strong></p>
      {checkout.state === 'draft' && <ApprovalForm checkout={checkout} onApproved={setCheckout} />}
      {checkout.state === 'approved' && <div><p className="notice" role="status">MFA approval recorded for this checkout.</p><button disabled={busy || !ready} onClick={submit}>{busy ? 'Waiting for Visa…' : 'Send approved request to Visa sandbox'}</button></div>}
      {!['draft', 'approved'].includes(checkout.state) && <SandboxReceipt checkout={checkout} />}
      <a className="text-button new-checkout" href="/checkout">Start a separate checkout</a>
    </> : <form onSubmit={create}>
      {products.map(product => <label key={product.id}>{product.name} · {money(product.unit_amount)}<input aria-label={product.name + ' quantity'} type="number" min={0} max={10} step={1} value={quantities[product.id] || 0} onChange={e => setQuantities({ ...quantities, [product.id]: Number(e.target.value) })} /></label>)}
      <button disabled={busy || !products.length}>{busy ? 'Preparing…' : 'Review sample checkout'}</button>
    </form>}
    {!loading && !ready && <p className="notice">Visa sandbox credentials are unavailable. You can prepare and approve a sample; sending requires server configuration.</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>
}
