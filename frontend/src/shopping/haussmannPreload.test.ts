import assert from 'node:assert/strict'
import test from 'node:test'
import {getHaussmannPreload, preloadHaussmann, subscribeHaussmannPreload} from './haussmannPreload'

test('gallery background jobs deduplicate repeated effects, retry errors and resume after navigation cancellation', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalFetch = globalThis.fetch
  const events = new EventTarget()
  const phases: string[] = []
  let calls = 0
  Object.defineProperty(globalThis, 'window', {configurable:true,value:events})
  globalThis.fetch = async (_url, options) => {
    calls++
    if (calls === 1) return new Response(null, {status:503})
    if (calls === 2) return new Promise((_resolve,reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), {once:true})
    })
    return new Response(null, {headers:{'content-type':'application/octet-stream'}})
  }
  const unsubscribe = subscribeHaussmannPreload(() => phases.push(getHaussmannPreload().phase))
  try {
    const first = preloadHaussmann()
    assert.equal(preloadHaussmann(),first)
    await first
    assert.equal(calls,1); assert.equal(getHaussmannPreload().phase,'error')
    const retry = preloadHaussmann(true)
    assert.equal(preloadHaussmann(),retry)
    events.dispatchEvent(new Event('pagehide'))
    await retry
    assert.equal(getHaussmannPreload().phase,'idle')
    await preloadHaussmann()
    assert.equal(calls,3); assert.equal(getHaussmannPreload().phase,'ready')
    await preloadHaussmann()
    assert.equal(calls,3)
    assert.ok(phases.includes('loading'))
  } finally {
    unsubscribe()
    globalThis.fetch=originalFetch
    if (originalWindow) Object.defineProperty(globalThis,'window',originalWindow)
    else Reflect.deleteProperty(globalThis,'window')
  }
})
