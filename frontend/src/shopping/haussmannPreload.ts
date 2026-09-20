import { prepareHaussmann } from '../scene/playcanvas/haussmannDownload'
import type { AssetProgress } from '../scene/playcanvas/assets'
import manifest from '../../../shared/rooms/haussmann-apartment/manifest.json'

type State = AssetProgress & { phase: 'idle' | 'loading' | 'ready' | 'error' }
let state: State = { phase: 'idle', loaded: 0, total: 0 }
let task: Promise<void> | undefined
const listeners = new Set<() => void>()
const publish = (next: State) => { state = next; for (const listener of listeners) listener() }
export const getHaussmannPreload = () => state
export function subscribeHaussmannPreload(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** One background transfer per page, including React StrictMode's repeated effects. */
export function preloadHaussmann(retry = false) {
  if (task && !(retry && state.phase === 'error')) return task
  const controller = new AbortController()
  const cancel = () => controller.abort()
  window.addEventListener('pagehide', cancel, { once: true })
  publish({ phase: 'loading', loaded: 0, total: 0, message: 'Checking your apartment…' })
  task = prepareHaussmann(manifest.room.scan.visualUrl, value => publish({ ...value, phase: 'loading' }), controller.signal)
    .then(prepared => { prepared.release(); publish({ ...state, phase: 'ready', message: 'Ready to explore' }) })
    .catch(error => {
      if (controller.signal.aborted) {
        task = undefined
        publish({ phase: 'idle', loaded: 0, total: 0 })
      } else publish({ ...state, phase: 'error', message: error instanceof Error ? error.message : 'Download interrupted. Try again.' })
    })
    .finally(() => window.removeEventListener('pagehide', cancel))
  return task
}
