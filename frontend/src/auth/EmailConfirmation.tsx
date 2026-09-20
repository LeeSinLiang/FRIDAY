import { useState, type FormEvent } from 'react'
import { assertSuccess, auth, request } from './api'
import { useAuth } from './AuthProvider'

export default function EmailConfirmation() {
  const { account, refresh } = useAuth()
  const [sent, setSent] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    setBusy(true); setError('')
    try {
      const result = await auth('account/email', 'PUT', { email: account?.email })
      if (result.status === 403) throw new Error('A confirmation email was requested recently. Wait a minute before sending another.')
      assertSuccess(result)
      setSent(true); setConfirmed(false); setCode('')
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }

  async function verify(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await request('/api/accounts/email/confirm/', 'POST', { key: code.trim() })
      if (result.status === 409) throw new Error('This confirmation has expired or was already used. Send another email for a new code.')
      assertSuccess(result)
      setSent(false); setConfirmed(true); setCode('')
      await refresh()
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }

  return <details className="security-actions">
    <summary>Confirm your email address</summary>
    <p>Send a fresh confirmation code to {account?.email}.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {confirmed && <p className="notice" role="status">Email confirmed using the new code.</p>}
    {sent && <>
      <p role="status">{account?.local_inbox ? 'Refresh the Local test inbox below to find your code.' : 'Check your email, including spam, for the latest code.'} It expires after 10 minutes.</p>
      <form onSubmit={verify}>
        <label>Email confirmation code<input autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} required /></label>
        <button disabled={busy}>{busy ? 'Working…' : 'Confirm email'}</button>
      </form>
    </>}
    <button type="button" className="secondary" disabled={busy} onClick={send}>{sent ? 'Send another confirmation email' : 'Send confirmation email'}</button>
  </details>
}
