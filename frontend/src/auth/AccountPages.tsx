import { useState, type FormEvent } from 'react'
import { assertSuccess, auth, restartAuth, type AuthDestination } from './api'
import { useAuth } from './AuthProvider'
import type { AccountStep } from './flow'

export default function AccountPages({ step }: { step: AccountStep }) {
  const { account, refresh } = useAuth()
  const params = new URLSearchParams(location.search)
  const resetKey = params.get('reset')
  const mode = step === 'reset' ? 'reset' : step === 'create' ? 'signup' : 'login'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState(params.get('reset_done') === '1' ? 'Password changed. Sign in with your new password.' : '')
  const [resetSaved, setResetSaved] = useState(false)
  const verification = step === 'verify-email'
  const mfa = step === 'mfa'
  const localInbox = !!account?.local_inbox
  const heading = verification ? localInbox ? 'Check the local test inbox' : 'Verify your email' : mfa ? 'Enter your authenticator code' : mode === 'signup' ? 'Create your account' : mode === 'login' ? 'Sign in to FRIDAY' : 'Reset your password'
  const verificationHint = localInbox
    ? 'No email was sent to Gmail or another external mailbox. Click Refresh inbox below and enter the latest verification code here. The code expires after 10 minutes.'
    : 'Enter the verification code from your email in this browser. It expires after 10 minutes.'

  async function leaveAttempt(destination: AuthDestination) {
    setBusy(true); setError('')
    try { await restartAuth(destination) }
    catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      let result
      if (verification) result = await auth('auth/email/verify', 'POST', { key: code.trim() })
      else if (mfa) result = await auth('auth/2fa/authenticate', 'POST', { code: code.trim() })
      else if (mode === 'reset') {
        if (resetKey) {
          if (password !== confirm) throw new Error('Passwords do not match.')
          result = await auth('auth/password/reset', 'POST', { key: resetKey, password })
        } else result = await auth('auth/password/request', 'POST', { email })
      } else {
        if (mode === 'signup' && password !== confirm) throw new Error('Passwords do not match.')
        result = await auth('auth/' + mode, 'POST', { email, password })
      }
      const next = result.data?.flows?.some((flow: { is_pending?: boolean }) => flow.is_pending)
      const resetCompleted = mode === 'reset' && resetKey && result.status === 401 && !result.errors?.length
      if (!(result.status === 401 && next) && !resetCompleted) assertSuccess(result)
      setPassword(''); setConfirm(''); setCode('')
      if (mode === 'reset' && !verification && !mfa) {
        if (resetKey) {
          setResetSaved(true)
          await restartAuth('/account/sign-in?reset_done=1')
          return
        }
        setMessage(localInbox ? 'If this account exists, its reset message is in the Local test inbox below. Click Refresh inbox; no external email is sent.' : 'If this account exists, a password reset email has been sent.')
      }
      await refresh()
    } catch (error) { setError((error as Error).message); await refresh() }
    finally { setBusy(false) }
  }

  async function resend() {
    setBusy(true); setError('')
    try { const result = await auth('auth/email/verify/resend', 'POST', {}); assertSuccess(result); setMessage(localInbox ? 'A new code is in the Local test inbox below. Click Refresh inbox and use the latest message.' : 'A new verification code has been sent.') }
    catch (error) { setError((error as Error).message); await refresh() }
    finally { setBusy(false) }
  }

  if (resetSaved) return <section className="auth-panel">
    <p className="eyebrow">Your account</p><h1>Password changed</h1>
    <p>Your new password is saved. Continue to sign in.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <button disabled={busy} onClick={() => leaveAttempt('/account/sign-in?reset_done=1')}>{busy ? 'Returning to sign in…' : 'Back to sign in'}</button>
  </section>

  return <section className="auth-panel">
    <p className="eyebrow">Your account</p><h1>{heading}</h1>
    <p className="muted">{verification ? verificationHint : mfa ? 'Open your connected authenticator and enter its current six-digit code. You can also use an unused recovery code.' : mode === 'signup' ? 'Next, verify your email and connect an authenticator.' : mode === 'login' ? 'Enter your email and password. We’ll ask for your authenticator code next if you’ve connected one.' : 'We’ll email you a link to reset your password.'}</p>
    {localInbox && !verification && !mfa && <p className="notice">Local test mode: verification and password-reset messages appear in the Local test inbox below. Nothing is sent to your email address.</p>}
    <form onSubmit={submit}>
      {verification || mfa ? <label>{verification ? 'Email verification code' : 'Authenticator or recovery code'}<input autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} required autoFocus /></label> : <>
        {!resetKey && <label>Email address<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>}
        {(mode !== 'reset' || resetKey) && <label>Password<input type="password" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required /></label>}
        {(mode === 'signup' || resetKey) && <label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></label>}
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}
      <button disabled={busy}>{busy ? 'Working…' : verification ? 'Verify email' : mfa ? 'Verify and sign in' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Sign in' : resetKey ? 'Save new password' : 'Send reset email'}</button>
    </form>
    {verification && <div className="verification-help"><p>Already registered, used the wrong email, or need to reset your password? Choose an option below.</p></div>}
    {(verification || mfa) && <div className="auth-actions" aria-label="Other account actions">
      {verification && <button type="button" className="secondary" disabled={busy} onClick={resend}>Send another code</button>}
      <button type="button" className="secondary" disabled={busy} onClick={() => leaveAttempt('/account/sign-in')}>Back to sign in</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => leaveAttempt('/account/create')}>Create a new account</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => leaveAttempt('/account?mode=reset')}>Reset password</button>
    </div>}
    {!verification && !mfa && <div className="form-links">
      <a href={mode === 'login' ? '/account/create' : '/account/sign-in'}>{mode === 'login' ? 'Create a new account' : 'Already registered? Sign in'}</a>
      {mode === 'login' && <a href="/account?mode=reset">Forgot password?</a>}
    </div>}
  </section>
}
