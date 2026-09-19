import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { auth, request } from './api'
import type { Account } from './flow'

type State = { account: Account | null; pending: string | null; loading: boolean; error: string; refresh: () => Promise<void> }
const Context = createContext<State | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const info = await request('/api/accounts/status/')
      if (info.status !== 200) throw new Error('Account service unavailable. Check that Django is running.')
      const session = await auth('auth/session')
      if (![200, 401].includes(session.status)) throw new Error('Could not load your session. Try again.')
      setAccount(info as unknown as Account)
      setPending(session.data?.flows?.find((flow: { is_pending?: boolean }) => flow.is_pending)?.id || null)
      setError('')
    } catch (error) { setError((error as Error).message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return <Context.Provider value={{ account, pending, loading, error, refresh }}>{children}</Context.Provider>
}

export function useAuth() {
  const state = useContext(Context)
  if (!state) throw new Error('AuthProvider is required')
  return state
}
