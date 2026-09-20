import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { request } from '../auth/api'

export type CartItem = { id: string; roomId: string; instanceId: string; product_id: string; name: string; unit_amount: number; thumbnail: string; available: boolean }
export type Cart = { id: string; revision: number; items: CartItem[]; amount: number; currency: string; owned: boolean }
export async function cartRequest<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const result = await request('/api/cart/' + path, method, body)
  if (result.status >= 400) throw new Error((result as unknown as {error?: {message: string}}).error?.message || result.errors?.[0]?.message || 'Your cart could not be updated. Try again.')
  return result as unknown as T
}
type State = { cart: Cart | null; error: string; refresh: () => Promise<void> }
const Context = createContext<State>({ cart: null, error: '', refresh: async () => {} })
export const useCart = () => useContext(Context)

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null)
  const [error, setError] = useState('')
  const pending = useRef<Promise<void> | null>(null)
  const refresh = useCallback(() => {
    if (pending.current) return pending.current
    pending.current = cartRequest<Cart>().then(value => { setCart(value); setError('') }).catch(e => setError(e.message)).finally(() => { pending.current = null })
    return pending.current
  }, [])
  useEffect(() => {
    void refresh()
    const changed = () => { void refresh() }
    window.addEventListener('friday-cart-changed', changed)
    return () => window.removeEventListener('friday-cart-changed', changed)
  }, [refresh])
  // Establish one guest cookie before the editor and account routes request their data.
  return <Context.Provider value={{cart, error, refresh}}>{cart ? children : <main className="shop-loading"><h1>FRIDAY.</h1><p role={error ? 'alert' : 'status'}>{error || 'Opening your space…'}</p>{error && <button className="button" onClick={() => void refresh()}>Try again</button>}</main>}</Context.Provider>
}
