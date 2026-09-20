import { useCart } from './CartProvider'
import './shopping.css'

export type RoomChoice = { id: string; title: string; description: string; thumbnail: string }
export const rooms: RoomChoice[] = import.meta.env.VITE_PUBLIC_ROOMS || []

export function RoomUnavailable() {
  return <main className="shop-loading"><p>FRIDAY.</p><h1>This room isn’t available.</h1><a className="button" href="/rooms">Back to rooms</a></main>
}

export default function RoomSelection() {
  const {cart} = useCart()
  return <div className="shopping-app">
    <header className="shop-header"><a className="wordmark" href="/rooms">FRIDAY<span>.</span></a><a className="shop-cart-link" href="/cart">Your cart <span>{cart?.items.length ?? 0}</span></a></header>
    <main className="room-gallery"><div className="gallery-intro"><p className="shop-kicker">A space to make your own</p><h1>Start with a room.</h1><p>Find your furniture. Try it in place. Bring it all together.</p></div>
      <div className="room-choices">{rooms.map((room, i) => <a className="room-choice" href={'/room/' + room.id} key={room.id}>
        <div className="room-choice-image"><img src={room.thumbnail} alt={room.title + ' illustration'} loading={i ? 'lazy' : 'eager'}/><span>Explore room ↗</span></div>
        <div className="room-choice-caption"><div><h2>{room.title}</h2><p>{room.description}</p></div><span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span></div>
      </a>)}</div>
      {!rooms.length && <p role="status">No rooms are available yet. Please check back shortly.</p>}
    </main><footer className="shop-footer"><span>FRIDAY / HackMIT 2026</span><span>Explore freely. Sign in when you open your cart.</span></footer>
  </div>
}
