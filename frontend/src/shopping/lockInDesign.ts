import { request } from '../auth/api'
import type { Cart } from './CartProvider'

export type LockInDesignInput = {
  roomId: string
  variantSetId: string
  variantId: string
  baseRevision: number
  requestId?: string
}

export type LockInDesignResult = {
  cart: Cart
  sceneRevision: number
  variantId: string
  checkoutUrl: '/checkout'
}

export async function lockInSelectedDesign(input: LockInDesignInput): Promise<LockInDesignResult> {
  const result = await request('/api/checkout/lock-design/', 'POST', {
    ...input,
    requestId: input.requestId ?? crypto.randomUUID(),
  })
  if (result.status >= 400) {
    const failure = result as typeof result & { error?: { message?: string } }
    throw new Error(failure.error?.message || result.errors?.[0]?.message || 'The selected design could not be locked in. Try again.')
  }
  window.dispatchEvent(new CustomEvent('friday-cart-changed'))
  return result as unknown as LockInDesignResult
}
