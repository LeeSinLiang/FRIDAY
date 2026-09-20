import { useState, type FormEvent } from 'react'
import { assertSuccess, auth } from './api'
import { useAuth } from './AuthProvider'
import EmailConfirmation from './EmailConfirmation'

export default function SecuritySettings() {
  const { refresh } = useAuth()
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('')
    try { await action(); await refresh() } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  async function reauthenticate(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      assertSuccess(await auth('auth/2fa/reauthenticate', 'POST', { code: code.trim() }))
      setCode(''); setMessage('Identity confirmed. You can update security settings for five minutes.')
    })
  }
  return <section className="auth-panel">
    <p className="eyebrow">Settings</p><h1>Account security</h1>
    <p className="muted">Your authenticator is connected. Manage recovery codes or confirm your email here.</p>
    <a className="settings-link" href="/account">Back to my account</a>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {codes.length > 0 && <div className="recovery"><h2>Save your recovery codes</h2><p>Each code works once. These codes are shown once; keep them somewhere private.</p><ul>{codes.map(value => <li key={value}><code>{value}</code></li>)}</ul><button className="secondary" onClick={() => setCodes([])}>I saved my recovery codes</button></div>}
    {!codes.length && <button className="secondary" disabled={busy} onClick={() => run(async () => { const result = await auth('account/authenticators/recovery-codes'); assertSuccess(result); setCodes(result.data?.unused_codes || []); if (!result.data?.unused_codes) setMessage('Your codes were already shown. Confirm your identity below to generate replacements.') })}>Show recovery codes</button>}
    <EmailConfirmation />
    <details className="security-actions"><summary>Confirm identity or manage recovery</summary>
      <form onSubmit={reauthenticate}>
        <label>Authenticator or recovery code<input autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} required /></label>
        <button disabled={busy}>Confirm identity</button>
      </form>
      <>
        <button className="secondary" disabled={busy} onClick={() => run(async () => { const result = await auth('account/authenticators/recovery-codes', 'POST', {}); assertSuccess(result); setCodes(result.data?.unused_codes || []); setMessage('New recovery codes created. Previous recovery codes no longer work.') })}>Replace recovery codes</button>
        <p>To replace a lost authenticator, confirm a recovery code, remove the old authenticator, then set up a new one. Checkout stays blocked until setup is complete.</p>
        <button className="text-button" disabled={busy} onClick={() => run(async () => { assertSuccess(await auth('account/authenticators/totp', 'DELETE')); setCodes([]); setMessage('Authenticator removed. Set up a new authenticator to restore checkout access.') })}>Remove authenticator</button>
      </>
    </details>
  </section>
}
