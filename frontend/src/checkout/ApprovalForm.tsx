import { useState, type FormEvent } from 'react'
import { request } from '../auth/api'
import { type Checkout, isPriced, money } from './types'
import { approveAndSubmitCheckout } from './approveAndSubmit'

export default function ApprovalForm({ checkout, onCompleted, onUncertain }: { checkout: Checkout; onCompleted: (value: Checkout) => void; onUncertain: () => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false)
  const unpriced = checkout.snapshot.items.filter(line => !isPriced(line)).reduce((sum, line) => sum + line.quantity, 0)
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<'idle'|'sending'>('idle')
  const [error, setError] = useState('')
  async function approve(event: FormEvent) {
    event.preventDefault(); setPhase('sending'); setError('')
    try {
      const completed = await approveAndSubmitCheckout(checkout, confirmed, code, request)
      setCode(''); onCompleted(completed)
    } catch (error) {
      setError((error as Error).message)
      await onUncertain().catch(() => {})
    } finally { setPhase('idle') }
  }
  return <form onSubmit={approve}>
    <label className="approval-checkbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required /><span>{unpriced ? `I approve the priced items for ${money(checkout.snapshot.amount)} USD at ${checkout.snapshot.vendor.name} in the Visa sandbox. The ${unpriced === 1 ? 'one piece' : unpriced + ' pieces'} with no known price ${unpriced === 1 ? 'is' : 'are'} not part of this payment.` : `I approve these items for ${money(checkout.snapshot.amount)} USD at ${checkout.snapshot.vendor.name} in the Visa sandbox.`}</span></label>
    <label>Fresh authenticator code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)} required /></label>
    <p className="muted">Use an unused code. If you just signed in with this code, wait for the next one. Approval expires after five minutes.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <button disabled={phase !== 'idle' || !confirmed || !checkout.visa?.ready}>{phase === 'sending' ? 'Approving and waiting for Visa…' : 'Approve and send to Visa sandbox'}</button>
  </form>
}
