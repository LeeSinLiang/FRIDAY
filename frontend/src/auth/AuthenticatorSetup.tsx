import { useState, type FormEvent } from 'react'
import { assertSuccess, auth } from './api'
import { useAuth } from './AuthProvider'

export default function AuthenticatorSetup({ onRecovery, onComplete }: { onRecovery: () => void; onComplete: () => void }) {
  const { account, refresh } = useAuth()
  const [password, setPassword] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }

  async function recoveryCodes() {
    const result = await auth('account/authenticators/recovery-codes')
    assertSuccess(result)
    setCodes(result.data?.unused_codes || [])
  }

  async function start(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      assertSuccess(await auth('auth/reauthenticate', 'POST', { password }))
      setPassword('')
      const result = await auth('account/authenticators/totp')
      if (result.status === 404 && result.meta?.secret) setSecret(result.meta.secret)
      else { assertSuccess(result); await refresh() }
    })
  }

  async function activate(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      assertSuccess(await auth('account/authenticators/totp', 'POST', { code: code.trim() }))
      setSecret(''); setCode('')
      onRecovery()
      await refresh()
      await recoveryCodes()
    })
  }

  return <section className="auth-panel">
    <p className="eyebrow">Finish account setup</p>
    <h1>{account?.mfa_enabled ? 'Save your recovery codes' : secret ? 'Scan with your authenticator' : 'Get your authenticator QR code'}</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {account?.mfa_enabled ? <>
      <p>Your authenticator is connected. Keep your recovery codes somewhere private so you can sign in if you lose your phone.</p>
      {codes === null ? <button disabled={busy} onClick={() => run(recoveryCodes)}>Show recovery codes</button> : <>
        {codes.length ? <div className="recovery"><p>Each code works once. Save them before leaving this page.</p><ul>{codes.map(value => <li key={value}><code>{value}</code></li>)}</ul></div> : <p>These codes were already displayed. You can generate replacements from account security after confirming your identity.</p>}
        <button disabled={busy} onClick={onComplete}>{codes.length ? 'I saved my recovery codes — continue' : 'Continue to my account'}</button>
      </>}
    </> : secret ? <>
      <p>Open your authenticator app, add an account and scan this QR code. Then enter the current six-digit code from its FRIDAY entry to finish connecting it.</p>
      <img className="qr-code" src="/api/accounts/totp-qr/" alt="Scan this QR code with your authenticator" />
      <details><summary>Can’t scan? Enter a setup key manually</summary><code className="setup-key">{secret}</code></details>
      <form onSubmit={activate}><label>Authenticator code<input value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" required pattern="[0-9]{6}" autoFocus /></label><button disabled={busy}>{busy ? 'Verifying…' : 'Connect authenticator'}</button></form>
    </> : <>
      <p>Your email is verified. Next, connect an authenticator app for future sign-ins.</p>
      <p id="authenticator-password-help">Enter your FRIDAY account password to show your setup QR code. If you just reset your password, use the new one.</p>
      <form onSubmit={start}><label>FRIDAY account password<input type="password" autoComplete="current-password" aria-describedby="authenticator-password-help" value={password} onChange={e => setPassword(e.target.value)} required /></label><button disabled={busy}>{busy ? 'Preparing QR code…' : 'Show setup QR code'}</button></form>
      <p className="muted">Once the QR code appears, scan it with your authenticator app and enter its six-digit code here. You only need to connect it once.</p>
    </>}
  </section>
}
