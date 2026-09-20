import type { CSSProperties } from 'react'
import type { RuntimeStatus } from './playcanvas/runtime'
import './room-arrival.css'

export default function RoomArrival({ status, connectionError, retryConnection }: {
  status: RuntimeStatus; connectionError?: string; retryConnection: () => void
}) {
  const failed = status.phase === 'error' || !!connectionError
  const fraction = status.progress === undefined ? undefined : Math.max(0, Math.min(1, status.progress))
  return <section className={`room-arrival${failed ? ' room-arrival--error' : ''}`} aria-label="Opening Haussmann apartment">
    <header className="room-arrival-header"><span>FRIDAY<span className="room-arrival-dot">.</span></span><a href="/rooms">Back to rooms</a></header>
    <div className="room-arrival-layout">
      <div className="room-arrival-copy">
        <h1>{failed ? 'A little pause.' : <>Making<br/> room<span>.</span></>}</h1>
        <p className="room-arrival-caption">{failed ? 'Your apartment is still here. Let’s try opening it again.' : 'Parquet underfoot. Light through tall windows. A space that’s about to be yours.'}</p>
        <div className="room-arrival-status">
          <p role="status" aria-live="polite">{connectionError || status.message}</p>
          {!failed && <>
            <div className="room-arrival-meter"><progress max={1} value={fraction} aria-label="Room preparation progress"/><span aria-hidden="true">{fraction === undefined ? '—' : `${Math.floor(fraction * 100)}%`}</span></div>
            <p className="room-arrival-note">Downloaded once. Kept in this browser when storage is available.</p>
          </>}
          {failed && <button type="button" onClick={connectionError ? retryConnection : () => location.reload()}>Try again</button>}
        </div>
      </div>
      <figure className="room-arrival-photo" style={{ '--arrival-progress': fraction ?? 0 } as CSSProperties}>
        <img src="/room-previews/haussmann-apartment.png" alt="The empty Haussmann apartment, with white mouldings and parquet flooring"/>
        <div className="room-arrival-shutter" aria-hidden="true"/>
        <div className="room-arrival-outline" aria-hidden="true"/>
        <figcaption><span>The Haussmann apartment</span><span>Your next blank canvas</span></figcaption>
      </figure>
    </div>
    <footer className="room-arrival-footer"><span>A space for what comes next.</span><a href="https://superspl.at/scene/4de797f4" target="_blank" rel="noreferrer">Stéphane Agullo · CC BY 4.0</a></footer>
  </section>
}
