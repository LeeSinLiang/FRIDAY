import { lazy, Suspense } from 'react'
import { CartProvider } from './shopping/CartProvider'
import RoomSelection, {rooms, RoomUnavailable} from './shopping/RoomSelection'

const CartPreview = lazy(() => import('./checkout/CartPreview'))
const Editor = lazy(() => import('./SplatEditor'))
const Account = lazy(() => import('./auth/AccountApp'))
const Legacy = lazy(() => import('./LegacyApp'))

function Route() {
  const query = new URLSearchParams(location.search)
  if (query.has('cartPreview')) return <CartPreview/>
  if (query.has('legacy') || query.has('testAssets')) return <Legacy/>
  if (location.pathname === '/' && (query.has('roomId') || query.has('room'))) return <Editor/>
  if (location.pathname === '/') return <Editor roomId="haussmann-apartment" shopping/>
  if (location.pathname === '/rooms') return <RoomSelection/>
  if (location.pathname === '/cart' || location.pathname === '/checkout' || location.pathname.startsWith('/account')) return <Account/>
  const match = /^\/room\/([a-zA-Z0-9_-]+)\/?$/.exec(location.pathname)
  if (match && rooms.some(room => room.id === match[1])) return <Editor roomId={match[1]} shopping/>
  return <RoomUnavailable/>
}

export default function App() {
  return <CartProvider><Suspense fallback={<div className="shop-loading" role="status">Opening your space…</div>}><Route/></Suspense></CartProvider>
}
