import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSuccess, restartAuth } from './api.ts'

test('a status-only rate limit tells the user to wait', () => {
  assert.throws(() => assertSuccess({ status: 429 }), /Too many attempts\. Wait/)
})

test('server errors have useful guidance without exposing server details', () => {
  assert.throws(() => assertSuccess({ status: 500, errors: [{ message: 'Internal configuration traceback' }] }), error => {
    assert.match(error.message, /account service encountered an error/)
    assert.doesNotMatch(error.message, /traceback/)
    return true
  })
})

test('validation and identity confirmation errors remain specific', () => {
  assert.throws(() => assertSuccess({ status: 400, errors: [{ message: 'Invalid code.' }] }), /Invalid code\./)
  assert.throws(() => assertSuccess({ status: 401, meta: { is_authenticated: true } }), /confirm your identity/)
  assert.doesNotThrow(() => assertSuccess({ status: 200 }))
})

function browserStubs(t, result) {
  const calls = []
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'csrftoken=test-csrf' } })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { assign: path => calls.push(['navigate', path]) } })
  t.after(() => { delete globalThis.document; delete globalThis.location })
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push([options.method, path, options.headers['X-CSRFToken']])
    return { status: result.status, json: async () => result }
  })
  return calls
}

test('reset completion clears the old attempt before opening sign-in', async t => {
  const calls = browserStubs(t, { status: 401, meta: { is_authenticated: false }, data: { flows: [{ id: 'login' }, { id: 'signup' }] } })
  await restartAuth('/account/sign-in?reset_done=1')
  assert.deepEqual(calls, [
    ['DELETE', '/_allauth/browser/v1/auth/session', 'test-csrf'],
    ['navigate', '/account/sign-in?reset_done=1'],
  ])
})

test('an uncleared or failed session never silently redirects back into a trapped flow', async t => {
  const result = { status: 401, meta: { is_authenticated: false }, data: { flows: [{ id: 'verify_email', is_pending: true }] } }
  const calls = browserStubs(t, result)
  await assert.rejects(restartAuth('/account/sign-in'), /Could not clear/)
  result.data.flows = []
  result.meta.is_authenticated = true
  await assert.rejects(restartAuth('/account/create'), /Could not clear/)
  result.meta.is_authenticated = false
  result.status = 403
  await assert.rejects(restartAuth('/account?mode=reset'))
  assert.equal(calls.some(([action]) => action === 'navigate'), false)
})
