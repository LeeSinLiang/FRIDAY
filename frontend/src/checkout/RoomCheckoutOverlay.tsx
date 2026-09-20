import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import type { Cart } from '../shopping/CartProvider'
import { money, type Checkout } from './types'
import { cartLines } from './cartLines'
import { roomCheckoutLines, sandboxDispatchVerified } from './roomCheckoutPresentation'
import './room-checkout-overlay.css'

export type RoomCheckoutPhase = 'review'|'mfa'|'submitting'|'result'
export type RoomCheckoutOverlayProps = {
  cart: Cart; checkout: Checkout|null; phase: RoomCheckoutPhase; busy: boolean
  message?: string; error?: string; authHref?: string
  onReady: () => void; onSubmitCode: (code:string) => Promise<void>
  onClose: () => void; onRefresh: () => void; onDispatchComplete?: () => void
  onBillVisible?: (id:string,snapshotHash:string) => void
}

function useReducedMotion() {
  const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[])
  return reduced
}

function DispatchFilm({onComplete}:{onComplete?:()=>void}) {
  const reduced=useReducedMotion(),video=useRef<HTMLVideoElement>(null)
  const [ended,setEnded]=useState(false),[error,setError]=useState(''),[replay,setReplay]=useState(0)
  useEffect(()=>{
    if(reduced||ended)return
    const player=video.current;if(!player)return
    let active=true;setError('');player.currentTime=0
    void player.play().catch(()=>{if(active)setError('The animation could not play. Your verified sandbox result is saved.')})
    const watchdog=window.setTimeout(()=>{if(active){player.pause();setError('The animation paused. Your verified sandbox result is saved.')}},15000)
    return()=>{active=false;window.clearTimeout(watchdog);player.pause()}
  },[reduced,ended,replay])
  return <div className="room-checkout-dispatch">
    {!reduced&&!ended ? <video ref={video} muted playsInline preload="metadata" poster="/animations/order-dispatch.jpg" src="/animations/order-dispatch.mp4" aria-label="An origami bird carries a symbolic order envelope away" onEnded={()=>{setEnded(true);onComplete?.()}} onError={()=>setError('The animation is unavailable. Your verified sandbox result is saved.')}/>
      : <div className="room-checkout-settled"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 25 9 9 20-22"/></svg><p>Everything, taken care of.</p><small>Sandbox demonstration complete.</small></div>}
    {error&&<div className="room-checkout-film-error"><p role="status">{error}</p><button onClick={()=>setReplay(value=>value+1)}>Replay animation</button></div>}
  </div>
}

export default function RoomCheckoutOverlay({cart,checkout,phase,busy,message,error,authHref,onReady,onSubmitCode,onClose,onRefresh,onDispatchComplete,onBillVisible}:RoomCheckoutOverlayProps) {
  const panel=useRef<HTMLElement>(null),[code,setCode]=useState(''),[codeError,setCodeError]=useState(''),[billShown,setBillShown]=useState(false)
  const close=useRef(onClose);close.current=onClose
  const verified=sandboxDispatchVerified(checkout),lines=roomCheckoutLines(cart,checkout,cartLines(cart.items))
  const amount=checkout?.snapshot.amount??cart.amount
  const billVisible=useRef(onBillVisible);billVisible.current=onBillVisible
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;panel.current?.focus();return()=>{if(previous?.isConnected)previous.focus()}},[])
  useEffect(()=>{setCode('');setCodeError('')},[checkout?.id,phase])
  useEffect(()=>{
    setBillShown(false)
    if(!checkout||phase!=='review')return
    let announced=false,entryComplete=false
    const visible=()=>{if(entryComplete&&!announced&&!document.hidden&&panel.current?.getBoundingClientRect().width){announced=true;setBillShown(true);billVisible.current?.(checkout.id,checkout.snapshot_hash)}}
    const media=matchMedia('(prefers-reduced-motion: reduce)')
    const timer=window.setTimeout(()=>{entryComplete=true;visible()},media.matches?0:1600)
    document.addEventListener('visibilitychange',visible)
    return()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}
  },[checkout?.id,checkout?.snapshot_hash,phase])
  const keyDown=(event:KeyboardEvent)=>{
    event.stopPropagation()
    if(event.key==='Escape'){event.preventDefault();close.current();return}
    if(event.key!=='Tab')return
    const nodes=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')??[])
    const first=nodes[0],last=nodes.at(-1)
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel.current)){event.preventDefault();first?.focus()}
  }
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return
    if(!/^\d{6}$/.test(code)){setCodeError('Enter the six digits from your authenticator.');return}
    const entered=code;setCode('');setCodeError('')
    try{await onSubmitCode(entered)}catch{setCodeError('Verification could not finish. Check the saved status before trying again.')}
  }
  return <div className="room-checkout-layer" onKeyDown={keyDown}>
    <section ref={panel} tabIndex={-1} className={`room-checkout-panel phase-${phase}`} role="dialog" aria-modal="true" aria-labelledby="room-checkout-title" aria-busy={busy}>
      <header><div><h1 id="room-checkout-title">{verified?'A little closer to home.':phase==='mfa'?'One final check.':phase==='submitting'?'Taking care of it.':'Your room, brought together.'}</h1><p>{verified?'Your sandbox request is verified.':phase==='mfa'?'Verify with your authenticator to send this sandbox request.':'Your selection stays here, with your room.'}</p></div><button className="room-checkout-close" onClick={onClose} aria-label="Close checkout and return to the room"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 12"/></svg></button></header>
      {verified ? <><DispatchFilm key={checkout!.id} onComplete={onDispatchComplete}/><p className="room-checkout-honesty">Sandbox verification succeeded. No payment was charged and no merchant order was created. The bird illustrates the handoff.</p></> : <>
        <ul className="room-checkout-items" aria-label="Selected furniture">{lines.map((line,index)=><li key={line.id} style={{'--item-delay':`${Math.min(index,7)*70}ms`,'--item-origin':index%2?'36px':'-36px'} as CSSProperties}>
          {line.thumbnail?<img src={line.thumbnail} alt=""/>:<span className="room-checkout-no-image" aria-hidden="true"/>}
          <span><strong>{line.name}</strong><small>Quantity {line.quantity}</small></span><b>{line.amount===null?'Price unavailable':money(line.amount)}</b>
        </li>)}</ul>
        {!lines.length&&<p>Your cart is empty. Return to your room to choose furniture.</p>}
        <div className="room-checkout-total"><span>{lines.some(line=>line.amount===null)?'Priced items · USD':'Furniture total · USD'}</span><strong>{money(amount)}</strong></div>
        <p className="room-checkout-honesty">Sandbox demonstration only. No real payment or merchant order. {checkout?'This is the saved checkout total.':'Your cart will be checked before approval.'}</p>
      </>}
      {message&&<p className="room-checkout-message" role="status">{message}</p>}
      {error&&<p className="room-checkout-error" role="alert">{error}</p>}
      {phase==='review'&&!verified&&<footer>{authHref?<><a className="room-checkout-primary" href={authHref} target="_blank" rel="noopener noreferrer">Sign in / finish setup</a><button className="room-checkout-secondary" disabled={busy} onClick={onReady}>I’m signed in — refresh</button></>:<button className="room-checkout-primary" disabled={busy||!lines.length||!checkout||!billShown} onClick={onReady}>{busy||!billShown?'Preparing your review…':'Ready to continue'}</button>}<button className="room-checkout-secondary" onClick={onClose}>Back to my room</button>{!checkout&&!busy&&!authHref&&<button className="room-checkout-secondary" onClick={onReady}>Retry checkout review</button>}</footer>}
      {phase==='mfa'&&!verified&&<form className="room-checkout-code" onSubmit={event=>void submit(event)}><label htmlFor="room-checkout-code">Fresh authenticator code</label><input id="room-checkout-code" autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} required/><small>Type or say an unused six-digit code. Spoken codes are transcribed online, then sent directly for verification.</small>{codeError&&<p role="alert" className="room-checkout-error">{codeError}</p>}<button className="room-checkout-primary" disabled={busy||code.length!==6||!checkout?.visa?.ready}>{busy?'Verifying…':`Approve ${money(amount)} and send sandbox request`}</button></form>}
      {phase==='submitting'&&!verified&&<p className="room-checkout-message" role="status">Verifying the saved request. Please wait…</p>}
      {phase==='result'&&!verified&&<footer><button className="room-checkout-primary" disabled={busy} onClick={onRefresh}>Check saved status</button><button className="room-checkout-secondary" onClick={onClose}>Back to my room</button></footer>}
      {verified&&<footer><button className="room-checkout-primary" onClick={onClose}>Return to my room</button></footer>}
    </section>
  </div>
}
