import { useEffect, useState, type CSSProperties } from 'react'
import { cartLines, linePrice, stageLines, type CartPiece } from './cartLines'
import { billLine, money } from './types'
import './cart-choreography.css'

// The cart preview's choreography, folded into the cart itself and driven by the real cart: the shopper's own pieces
// gather into the cart. DOM and CSS only, on a plain background. No room, no WebGL, no film, and no "on its way":
// nothing has been ordered on this page. It is decoration beside the cart summary (which carries the semantics),
// so it is aria-hidden, takes no pointer events, and never gates the checkout button.

const ARRIVE_MS = 1400
const STAGGER_MS = 320
// Where each piece comes in from, in pixels from its resting place. Fixed, so it looks the same every time.
const ORIGINS: [number, number][] = [[-150, -90], [150, -100], [-190, 30], [190, 20], [-90, -130], [90, -130], [-210, -50], [210, -50]]

type Props = { items: readonly CartPiece[]; itemCount: number; pricedCount: number; amount: number }

export default function CartChoreography({ items, itemCount, pricedCount, amount }: Props) {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [together, setTogether] = useState(reduced)
  const { shown, more } = stageLines(cartLines(items))
  const tiles = shown.length + (more ? 1 : 0)

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    // One way only: once the pieces are together they stay together, whatever the cart or the motion setting does
    // next, so nothing ever replays. There is deliberately no "already played" ref here. StrictMode runs this effect
    // twice on mount in development (which is how the demo runs), and a flag set on the first run skipped the
    // animation entirely; a timer that is simply started again does not have that problem.
    if (together) return
    if (reduced || !tiles) { setTogether(true); return }
    const timer = setTimeout(() => setTogether(true), ARRIVE_MS + STAGGER_MS * (tiles - 1))
    return () => clearTimeout(timer)
  }, [reduced, tiles, together])

  if (!tiles) return null  // an empty cart has nothing to gather: no animation, just the empty cart
  const still = reduced || together
  const origin = (index: number): CSSProperties => ({ '--from-x': `${ORIGINS[index % ORIGINS.length][0]}px`,
    '--from-y': `${ORIGINS[index % ORIGINS.length][1]}px`, '--delay': `${index * STAGGER_MS}ms` } as CSSProperties)

  return <div className={`cart-choreo ${still ? 'is-together' : 'is-gathering'}${reduced ? ' is-still' : ''}`} aria-hidden="true">
    <p className="cart-choreo-caption">{still ? 'Everything, together.' : 'Bringing your pieces together.'}<span>{billLine(itemCount, pricedCount, amount)}</span></p>
    <ul className="cart-choreo-tiles">
      {shown.map((line, index) => <li key={line.productId} className="cart-choreo-tile" style={origin(index)}>
        {line.thumbnail ? <img src={line.thumbnail} alt=""/> : <span className="cart-choreo-blank"/>}
        <strong>{line.name}</strong>
        <small>{line.quantity > 1 && !line.priced ? `${line.quantity} × ` : ''}{linePrice(line, money)}</small>
      </li>)}
      {!!more && <li className="cart-choreo-tile cart-choreo-more" style={origin(shown.length)}><strong>+{more} more</strong><small>in your cart</small></li>}
    </ul>
  </div>
}
