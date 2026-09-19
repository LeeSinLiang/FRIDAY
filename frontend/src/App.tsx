import { lazy, Suspense, useEffect, useState } from 'react'

const Scene = lazy(() => import('./Scene'))

export default function App() {
  const [status, setStatus] = useState('Connecting to Django…')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health/', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('API unavailable')
        const data = await response.json()
        if (data.status !== 'ok') throw new Error('Unexpected API response')
        setStatus('Django API connected')
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setStatus('API unavailable — check the backend terminal')
      })
    return () => controller.abort()
  }, [])

  return (
    <main>
      <h1>FRIDAY</h1>
      <p>Local development starter · React + Three.js + Django</p>
      <p role="status">{status}</p>
      <div className="scene" aria-label="3D starter scene">
        <Suspense fallback={<p>Loading 3D scene…</p>}><Scene /></Suspense>
      </div>
    </main>
  )
}
