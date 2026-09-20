import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import { previewOrderDispatch } from './previewOrderDispatch'
import './cart-preview.css'

const Room = lazy(() => import('../SplatEditor'))
type Phase = 'waiting' | 'gathering' | 'assembling' | 'dispatching' | 'complete' | 'error'
const items = [
  { name: 'Modular sofa', agent: 'Spatial agent', image: '/models/furniture/modular-sofa-grey-scan/thumbnail.png', x: '-28vw', y: '-16vh', delay: '0s' },
  { name: 'LISABO table', agent: 'Sourcing agent', image: '/models/furniture/lisabo-dining-table-ash-veneer/thumbnail.png', x: '27vw', y: '-21vh', delay: '1s' },
]
const copy: Record<Phase, [string, string]> = {
  waiting: ['A room. A little possibility.', 'Opening the Gaussian room…'],
  gathering: ['Consider it taken care of.', 'Your agents are bringing the pieces together.'],
  assembling: ['Everything, together.', 'The order is taking shape.'],
  dispatching: ['And away it goes.', 'Your origami courier is carrying the order onward.'],
  complete: ['From possibility to on its way.', 'Fulfillment handoff visualized.'],
  error: ['The scene is taking a moment.', 'The preview could not finish. Replay from developer controls.'],
}
export default function CartPreview() {
  const [roomReady, setRoomReady] = useState(false)
  const [phase, setPhase] = useState<Phase>('waiting')
  const [run, setRun] = useState(0)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(media.matches)
    media.addEventListener('change', change)
    const replay = () => setRun(value => value + 1)
    window.addEventListener('friday:preview-order-dispatch', replay)
    return () => { media.removeEventListener('change', change); window.removeEventListener('friday:preview-order-dispatch', replay) }
  }, [])
  useEffect(() => {
    video.current?.pause()
    if (!roomReady) { setPhase('waiting'); return }
    if (reduced) { setPhase('complete'); return }
    setPhase('gathering')
    const assemble = setTimeout(() => setPhase('assembling'), 4800)
    const dispatch = setTimeout(() => setPhase('dispatching'), 6500)
    return () => { clearTimeout(assemble); clearTimeout(dispatch) }
  }, [roomReady, run, reduced])
  useEffect(() => {
    if (phase !== 'dispatching') return
    let active = true
    const player = video.current
    if (!player) { setPhase('error'); return }
    player.currentTime = 0
    void player.play().catch(() => { if (active) setPhase('error') })
    const watchdog = setTimeout(() => { if (active) setPhase('error') }, 15000)
    return () => { active = false; clearTimeout(watchdog); player.pause() }
  }, [phase, run])
  useEffect(() => {
    if (roomReady) return
    const timer = setTimeout(() => setPhase('error'), 25000)
    return () => clearTimeout(timer)
  }, [roomReady])
  const stage = phase === 'gathering' ? 0 : phase === 'assembling' ? 1 : phase === 'dispatching' ? 2 : phase === 'complete' ? 3 : -1
  return <main className={`agent-experience phase-${phase}`}>
    <div className="agent-room"><Suspense fallback={null}><Room observation onObservationReady={setRoomReady}/></Suspense></div>
    <div className="agent-atmosphere"/>
    <header className="agent-header"><a href="/" aria-label="Return to FRIDAY room">FRIDAY<span>.</span></a><span className="agent-live"><i/>{phase === 'complete' ? 'Settled, beautifully.' : 'Your agents are here.'}</span></header>
    <section key={run} className="agent-stage" aria-label="Agents assembling the order">
      {(phase === 'gathering' || phase === 'assembling') && <>
        <div className="agent-orbit orbit-one"/><div className="agent-orbit orbit-two"/>
        {items.map(item => <div key={item.name} className="agent-parcel" style={{ '--from-x': item.x, '--from-y': item.y, '--delay': item.delay } as CSSProperties}>
          <span className="agent-identity"><i/>{item.agent}</span>
          <div className="agent-object"><img src={item.image} alt={item.name}/><span>{item.name}</span></div>
          <span className="agent-tail"/>
        </div>)}
        <div className="agent-vessel"><div className="vessel-rim"/><svg viewBox="0 0 80 60" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M12 12h7l8 29h35l8-22H21M32 49h.1M59 49h.1" strokeLinecap="round"/></svg><span>{phase === 'assembling' ? 'Order assembled' : 'Gathering your pieces'}</span></div>
      </>}
      <div className="agent-dispatch-portal" aria-hidden={phase !== 'dispatching'}><video ref={video} muted playsInline preload="metadata" src="/animations/order-dispatch.mp4" onEnded={() => setPhase('complete')} onError={() => { if (phase === 'dispatching') setPhase('error') }} aria-label="Origami courier collects and carries the order away"/></div>
      {phase === 'complete' && <div className="agent-arrival"><span className="arrival-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></span><span>Order carried onward</span><small>Demonstration complete</small></div>}
    </section>
    <div className="agent-narrative" aria-live="polite"><h1>{copy[phase][0]}</h1><p>{copy[phase][1]}</p></div>
    <footer className="agent-footer"><div className="agent-progress" aria-label="Demo progress">{['Gather', 'Compose', 'Dispatch'].map((label, index) => <span key={label} className={stage >= index ? 'reached' : ''}><i/>{label}</span>)}</div><p>Agent choreography preview · no purchase submitted</p></footer>
    <details className="agent-dev"><summary>Developer controls</summary><button onClick={roomReady ? previewOrderDispatch : () => location.reload()} disabled={!roomReady && phase !== "error"}>{roomReady ? "Replay sequence" : "Reload room"}</button><a href="/">Return to room</a><span>Simulated agent events</span></details>
    <div className="agent-credit">HAUSSMANN APARTMENT · Stéphane Agullo · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></div>
  </main>
}
