import { useState, type FormEvent } from 'react'
import { assertSuccess, request } from '../auth/api'
import { type Checkout, money } from './types'

export default function ApprovalForm({ checkout, onApproved }: { checkout: Checkout; onApproved: (value: Checkout) => void }) {
  const [confirmed, setConfirmed] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function approve(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await request(`/api/checkouts/${checkout.id}/approve/`, 'POST', { snapshot_hash: checkout.snapshot_hash, approved: confirmed, code })
      assertSuccess(result); setCode(''); onApproved(result.data)
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <form onSubmit={approve}>
    <label className="approval-checkbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required /><span>I approve these items for {money(checkout.snapshot.amount)} USD at {checkout.snapshot.vendor.name} in the Visa sandbox.</span></label>
    <label>Fresh authenticator code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)} required /></label>
    <p className="muted">Use an unused code. If you just signed in with this code, wait for the next one. Approval expires after five minutes.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <button disabled={busy || !confirmed}>{busy ? 'Verifying approval…' : 'Approve with MFA'}</button>
  </form>
}
