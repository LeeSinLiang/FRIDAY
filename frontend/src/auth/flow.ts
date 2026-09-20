export type Account = {
  authenticated: boolean
  email: string | null
  email_verified: boolean
  mfa_enabled: boolean
  checkout_ready: boolean
  local_inbox: boolean
  recovery_acknowledged?: boolean
}

export type AccountStep = 'sign-in' | 'create' | 'verify-email' | 'mfa' | 'reset' | 'setup' | 'recovery' | 'ready' | 'security' | 'checkout'

export function accountStep(account: Account | null, pending: string | null, pathname: string, search: string, recoveryPending = false): AccountStep {
  if (!account?.authenticated) {
    const params = new URLSearchParams(search)
    if (params.has('reset') || params.get('mode') === 'reset') return 'reset'
    if (pending === 'mfa_authenticate') return 'mfa'
    if (pending === 'verify_email') return 'verify-email'
    return pathname === '/account/create' ? 'create' : 'sign-in'
  }
  if (!account.email_verified) return 'verify-email'
  if (!account.mfa_enabled) return 'setup'
  if (recoveryPending || account.recovery_acknowledged === false) return 'recovery'
  if (pathname === '/account/security') return 'security'
  if (pathname.startsWith('/checkout') && account.checkout_ready) return 'checkout'
  return 'ready'
}
