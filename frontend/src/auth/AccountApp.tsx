import { useState } from 'react'
import { AuthProvider, useAuth } from './AuthProvider'
import { restartAuth, type AuthDestination } from './api'
import { accountStep } from './flow'
import AccountPages from './AccountPages'
import AuthenticatorSetup from './AuthenticatorSetup'
import SecuritySettings from './SecuritySettings'
import LocalInbox from './LocalInbox'
import CheckoutReview from '../checkout/CheckoutReview'
import './account.css'

function AccountContent() {
  const { account, pending, loading, error, refresh } = useAuth()
  const [recoveryPending, setRecoveryPending] = useState(false)
  const [signoutError, setSignoutError] = useState('')
  const [navigating, setNavigating] = useState(false)
  const step = accountStep(account, pending, location.pathname, location.search, recoveryPending)
  const onboarding = ['create', 'verify-email', 'setup', 'recovery'].includes(step)
  const steps = onboarding ? ['Create account', 'Verify email', 'Set up authenticator'] : ['Sign in', 'Enter authenticator code', 'Continue to FRIDAY']
  const active = onboarding ? step === 'create' ? 0 : step === 'verify-email' ? 1 : 2 : step === 'sign-in' || step === 'reset' ? 0 : step === 'mfa' ? 1 : 2

  async function navigateAuth(destination: AuthDestination) {
    if (navigating) return
    setNavigating(true)
    setSignoutError('')
    try {
      await restartAuth(destination)
    } catch (error) { setSignoutError((error as Error).message) }
    finally { setNavigating(false) }
  }

  let content
  if (loading) content = <p role="status">Loading your account…</p>
  else if (error) content = <section><p role="alert">{error}</p><button onClick={refresh}>Try again</button></section>
  else if (step === 'setup' || step === 'recovery') content = <AuthenticatorSetup onRecovery={() => setRecoveryPending(true)} onComplete={() => { setRecoveryPending(false); if (location.pathname === '/account/security') location.assign('/account') }} />
  else if (step === 'security') content = <SecuritySettings />
  else if (step === 'checkout') content = <CheckoutReview />
  else if (step === 'ready') content = <section className="auth-panel">
    <p className="eyebrow">Account ready</p><h1>You’re signed in</h1>
    <p>Your email is verified and your authenticator is connected.</p>
    <a className="button-link" href="/">Continue to FRIDAY</a>
    {account?.checkout_ready && <a className="button-link secondary" href="/checkout">Review sandbox checkout</a>}
    <a className="settings-link" href="/account/security">Manage account security</a>
  </section>
  else content = <AccountPages step={step} />

  return <div className="account-app">
    <header className="account-header"><a className="brand" href="/">FRIDAY<span>Furnish with confidence.</span></a><nav aria-label="Account navigation">{account?.authenticated ? <><a href="/account">Account</a><button className="text-button" disabled={navigating} onClick={() => navigateAuth('/account/sign-in')}>Sign out</button></> : <><a href="/account/sign-in" aria-disabled={navigating} onClick={event => { if (pending || navigating) { event.preventDefault(); void navigateAuth('/account/sign-in') } }}>Sign in</a><a href="/account/create" aria-disabled={navigating} onClick={event => { if (pending || navigating) { event.preventDefault(); void navigateAuth('/account/create') } }}>Create account</a></>}</nav></header>
    <main className="account-layout"><aside>
      <p className="eyebrow">Your FRIDAY account</p><h2>{onboarding ? <>Make yourself<br />at home.</> : <>Welcome<br />back.</>}</h2>
      <p>{onboarding ? 'Verify your email, then connect your authenticator to protect your account.' : 'Sign in with your password and authenticator to pick up where you left off.'}</p>
      <ol className="progress-list" aria-label={onboarding ? 'Account setup steps' : 'Sign-in steps'}>{steps.map((label, index) => <li key={label} data-done={index < active || step === 'ready'} aria-current={index === active ? 'step' : undefined}>0{index + 1}<span>{label}</span></li>)}</ol>
      {account?.email && <p className="account-email">Signed in as<br /><strong>{account.email}</strong></p>}
    </aside><div>{signoutError && <p role="alert" className="error">{signoutError}</p>}{content}
      {account?.local_inbox && <LocalInbox verificationPending={step === 'verify-email'} />}</div>
    </main><footer className="account-footer">FRIDAY / HackMIT 2026 <span>Visa sandbox · No funds are moved</span></footer>
  </div>
}

export default function AccountApp() { return <AuthProvider><AccountContent /></AuthProvider> }
