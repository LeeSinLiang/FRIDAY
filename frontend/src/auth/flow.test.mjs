import assert from 'node:assert/strict'
import test from 'node:test'
import { accountStep } from './flow.ts'

const guest = { authenticated: false, email: null, email_verified: false, mfa_enabled: false, checkout_ready: false, local_inbox: false }
const verified = { ...guest, authenticated: true, email: 'test@example.com', email_verified: true }
const enrolled = { ...verified, mfa_enabled: true, checkout_ready: true }

test('new account completes verification and enrollment before checkout', () => {
  assert.equal(accountStep(guest, null, '/account/create', ''), 'create')
  assert.equal(accountStep(guest, 'verify_email', '/checkout', ''), 'verify-email')
  assert.equal(accountStep(verified, null, '/checkout', ''), 'setup')
  assert.equal(accountStep(enrolled, null, '/checkout', '', true), 'recovery')
  assert.equal(accountStep(enrolled, null, '/checkout', '', false), 'checkout')
})

test('returning accounts use a challenge, not enrollment or settings', () => {
  assert.equal(accountStep(guest, null, '/account', ''), 'sign-in')
  assert.equal(accountStep(guest, 'mfa_authenticate', '/account/create', ''), 'mfa')
  assert.equal(accountStep(guest, 'mfa_authenticate', '/account/security', ''), 'mfa')
  assert.equal(accountStep(enrolled, null, '/account/sign-in', ''), 'ready')
  assert.equal(accountStep(enrolled, null, '/account/security', ''), 'security')
})

test('reset links remain usable while a signup verification is pending', () => {
  assert.equal(accountStep(guest, 'verify_email', '/account', '?mode=reset'), 'reset')
  assert.equal(accountStep(guest, 'verify_email', '/account', '?reset=example'), 'reset')
  assert.equal(accountStep(guest, 'verify_email', '/account', ''), 'verify-email')
})

test('missing enrollment or verification cannot be skipped through settings URLs', () => {
  for (const path of ['/account', '/account/security', '/checkout']) {
    assert.equal(accountStep({ ...enrolled, email_verified: false }, null, path, ''), 'verify-email')
    assert.equal(accountStep(verified, null, path, ''), 'setup')
  }
})
