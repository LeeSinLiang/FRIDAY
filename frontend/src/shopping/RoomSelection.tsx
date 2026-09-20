import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { useCart } from './CartProvider'
import './shopping.css'
import './room-selection.css'

export type RoomChoice = { id: string; title: string; description: string; thumbnail: string; packaged: boolean }
export const rooms: RoomChoice[] = import.meta.env.VITE_PUBLIC_ROOMS || []

export function RoomUnavailable() {
  return <main className="shop-loading"><p>FRIDAY.</p><h1>This room isn’t available.</h1><a className="button" href="/rooms">Back to rooms</a></main>
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

/** The build's room list and previews remain authoritative; only presentation changes. */
export default function RoomSelection({ entrance = false }: { entrance?: boolean }) {
  const { cart } = useCart()
  const reducedMotion = useReducedMotion()
  const [phase, setPhase] = useState<'entrance' | 'opening' | 'gallery'>(entrance ? 'entrance' : 'gallery')
  const [order, setOrder] = useState(() => {
    const first = rooms.find(room => room.packaged)
    return first ? [first.id, ...rooms.filter(room => room !== first).map(room => room.id)] : rooms.map(room => room.id)
  })
  const [outgoing, setOutgoing] = useState<string | null>(null)
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set())
  const brand = useRef<HTMLAnchorElement>(null)
  const entranceBrand = useRef<HTMLAnchorElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const roomButtons = useRef(new Map<string, HTMLButtonElement>())
  const flight = useRef<Animation | null>(null)
  const shuffleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selected = rooms.find(room => room.id === order[0])
  const selectedIndex = rooms.findIndex(room => room.id === selected?.id)

  useEffect(() => {
    const onBack = () => {
      flight.current?.cancel()
      setPhase(location.pathname === '/' ? 'entrance' : 'gallery')
    }
    window.addEventListener('popstate', onBack)
    return () => {
      window.removeEventListener('popstate', onBack)
      flight.current?.cancel()
      if (shuffleTimer.current) clearTimeout(shuffleTimer.current)
    }
  }, [])

  function enter(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    if (phase !== 'entrance') return
    history.pushState(null, '', '/rooms')
    const from = entranceBrand.current?.getBoundingClientRect()
    const to = brand.current?.getBoundingClientRect()
    const finish = () => {
      setPhase('gallery')
      requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }))
    }
    if (reducedMotion || !from || !to || !entranceBrand.current?.animate) { finish(); return }
    setPhase('opening')
    flight.current = entranceBrand.current.animate([
      { transform: 'translate(0, 0) scale(1)' },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})` },
    ], { duration: 820, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' })
    void flight.current.finished.then(finish).catch(() => { /* navigation/unmount cancels the flight */ })
  }

  function choose(room: RoomChoice) {
    if (!room.packaged || room.id === selected?.id) return
    if (shuffleTimer.current) clearTimeout(shuffleTimer.current)
    setOutgoing(reducedMotion ? null : selected?.id ?? null)
    setOrder(current => [room.id, ...current.filter(id => id !== room.id)])
    if (!reducedMotion) shuffleTimer.current = setTimeout(() => setOutgoing(null), 680)
  }

  function moveSelection(key: string) {
    const available = rooms.filter(room => room.packaged)
    if (!available.length) return
    const current = available.findIndex(room => room.id === selected?.id)
    const index = key === 'Home' ? 0 : key === 'End' ? available.length - 1
      : (current + (key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1) + available.length) % available.length
    choose(available[index])
    roomButtons.current.get(available[index].id)?.focus()
  }

  return <div className={`friday-gallery friday-gallery--${phase}`}>
    <div className="friday-gallery-content" inert={phase !== 'gallery'} aria-hidden={phase !== 'gallery'}>
      <header className="friday-gallery-header">
        <a ref={brand} className="friday-gallery-brand" href="/" aria-label="FRIDAY home">FRIDAY<span>.</span></a>
        <a className="friday-gallery-cart" href="/cart">Your cart <span>{cart?.items.length ?? 0}</span></a>
      </header>
      <main className="friday-room-selector">
        <section className="friday-room-index" aria-label="Choose a room">
          <h1 ref={heading} tabIndex={-1}>Choose<br/>{' '}your space<span>.</span></h1>
          <div className="friday-room-options">{rooms.map((room, index) => <button
            key={room.id}
            ref={element => { if (element) roomButtons.current.set(room.id, element); else roomButtons.current.delete(room.id) }}
            className="friday-room-option" type="button" disabled={!room.packaged}
            aria-pressed={selected?.id === room.id} aria-controls="friday-selected-room"
            onClick={() => choose(room)}
            onKeyDown={event => {
              if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); moveSelection(event.key)
              }
            }}>
            <span className="friday-room-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <span className="friday-room-marker" aria-hidden="true"/>
            <span className="friday-room-option-copy"><span>{room.title}</span>
              <small>{!room.packaged ? 'Unavailable on this machine' : room.id === 'london-skyscraper' ? '34 levels' : 'One room'}</small>
            </span>
          </button>)}</div>
        </section>
        {selected ? <section id="friday-selected-room" className="friday-selected-room" aria-label="Room preview">
          <div className="friday-preview-stage">
            <div className="friday-preview-glass" aria-hidden="true"/>
            <div className="friday-preview-deck">{rooms.map(room => {
              const slot = order.indexOf(room.id)
              return <figure key={room.id} className={`friday-preview-card${outgoing === room.id ? ' friday-preview-card--outgoing' : ''}`}
                data-active={slot === 0} aria-hidden={slot !== 0}
                style={{ '--slot': slot, '--card-rotation': `${slot % 2 ? 2.6 : -2}deg`, zIndex: rooms.length - slot } as CSSProperties}>
                {failedImages.has(room.id) ? <div className="friday-preview-missing">Preview unavailable</div>
                  : <img src={room.thumbnail} alt={slot === 0 ? `${room.title} — current room preview` : ''}
                    fetchPriority={slot === 0 ? 'high' : 'auto'} draggable={false}
                    onError={() => setFailedImages(current => new Set(current).add(room.id))}/>}
              </figure>
            })}</div>
            <div className="friday-preview-rule" aria-hidden="true"/>
          </div>
          <div className="friday-preview-caption">
            <div className="friday-preview-description" aria-live="polite" aria-atomic="true">
              <p className="friday-space-number">SPACE {String(selectedIndex + 1).padStart(2, '0')}</p>
              <h2>{selected.title}</h2>
              <p>{selected.packaged ? selected.description : 'Import this room’s licensed model to open it.'}</p>
            </div>
            {selected.packaged && <a className="friday-enter-space" href={`/room/${selected.id}`}>Enter space <span aria-hidden="true">↗</span></a>}
          </div>
        </section> : <p role="status">No rooms are available yet. Please check back shortly.</p>}
      </main>
    </div>
    {phase !== 'gallery' && <div className="friday-entrance" aria-label="Welcome to FRIDAY">
      <div className="friday-entrance-art" aria-hidden="true"><img src="/artwork/friday-entry.jpg" alt="" fetchPriority="high"/></div>
      <div className="friday-entrance-wordmark">
        <a ref={entranceBrand} href="/rooms" onClick={enter} aria-label="Enter FRIDAY" aria-disabled={phase === 'opening'}>FRIDAY<span>.</span></a>
      </div>
    </div>}
  </div>
}
