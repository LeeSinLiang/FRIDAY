import type { ApiResult } from '../auth/api'
import type { Account } from '../auth/flow'
import type { Cart } from '../shopping/CartProvider'
import { approveAndSubmitCheckout } from './approveAndSubmit'
import { money, type Checkout } from './types'

export type RoomCheckoutPhase = 'review' | 'mfa' | 'submitting' | 'result'
export type RoomCheckoutState = {
  open: boolean; cart: Cart | null; checkout: Checkout | null; phase: RoomCheckoutPhase;
  busy: boolean; message: string; error: string; authHref?: string;
}
type Send = (path: string, method?: string, body?: unknown) => Promise<ApiResult>
const empty = (): RoomCheckoutState => ({open:false,cart:null,checkout:null,phase:'review',busy:false,message:'',error:''})

/** Only an explicit answer to the visible bill can advance to authentication. */
export function confirmsVisibleBill(text: string) {
  const answer=text.toLowerCase().replace(/’/g,"'").replace(/[,.!?]/g,' ').replace(/\s+/g,' ').trim()
  if (/^(?:(?:okay|ok|yes|yeah|yep|sure)\s*)+(?:please)?$/.test(answer)) return true
  return /^(?:(?:okay|ok|yes|yeah|yep|sure)\s+)*(?:please\s+)?(?:(?:i'm|i am)\s+)?(?:ready(?: to (?:pay|proceed|continue))?|go ahead(?: and (?:pay|proceed|confirm))?|let's (?:pay|do it|proceed)|(?:pay|proceed|continue|confirm)(?: (?:now|payment|with (?:the )?(?:payment|checkout|sandbox request)))?)(?: please)?$/.test(answer)
}

/** Runs locally after STT; codes never enter conversational routing or history. */
export function authenticatorDigits(text: string): string | null {
  const words: Record<string,string> = {zero:'0',oh:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9'}
  const value = text.toLowerCase().trim().replace(/^(?:(?:my|the)\s+)?(?:authenticator\s+)?code\s*(?:is\s*)?[:,-]?\s*/, '')
    .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, word => words[word])
    .replace(/[\s,.-]/g, '')
  return /^\d{6}$/.test(value) ? value : null
}

function checked(result: ApiResult) {
  if (result.status >= 400) throw Error(result.errors?.[0]?.message
    || (result as ApiResult & {error?:{message?:string}}).error?.message || 'This request could not be completed. Please try again.')
  return result
}

/** The room conversation controls existing checkout APIs; the server remains authoritative. */
export function createRoomCheckout(send: Send, changed: (state: RoomCheckoutState) => void) {
  let state = empty()
  let visibleBill = ''
  let approvedBill = ''
  let lastResult: {checkout: Checkout; cart: Cart} | null = null
  let operation = 0
  const publish = (patch: Partial<RoomCheckoutState>) => { state = {...state,...patch}; changed(state) }
  const identity = (checkout: Checkout) => `${checkout.id}:${checkout.snapshot_hash}`
  const prompt = (checkout: Checkout) => `Your bill is ${money(checkout.snapshot.amount)}. Are you ready to approve this sandbox request? No payment will be charged.`
  const valid = (checkout: Checkout) => checkout.state === 'draft' && checkout.visa?.ready && Date.parse(checkout.expires_at) > Date.now()

  async function begin(cart: Cart) {
    if (state.busy) return state.message
    const token = ++operation
    visibleBill = ''; approvedBill = ''
    publish({open:true,cart,checkout:null,phase:'review',busy:true,error:'',authHref:undefined,message:'Preparing your bill…'})
    try {
      const account = checked(await send('/api/accounts/status/')) as unknown as Account
      if (!account.checkout_ready || account.recovery_acknowledged === false) {
        const message = account.authenticated ? 'Finish your account verification and authenticator setup, then return here to review your bill.' : 'Sign in or create an account to continue. Your room and cart are saved.'
        publish({message,authHref:account.authenticated?'/account':'/account/sign-in'})
        return message
      }
      checked(await send('/api/cart/claim/', 'POST', {}))
      const current = checked(await send('/api/cart/')) as unknown as Cart
      const previous = lastResult?.cart.id === current.id && lastResult.cart.revision === current.revision ? lastResult.checkout : null
      const checkout = previous
        ? checked(await send(`/api/checkouts/${previous.id}/`)).data as Checkout
        : checked(await send('/api/cart/checkout/', 'POST', {revision:current.revision})) as unknown as Checkout
      if (token !== operation) return 'Checkout closed.'
      const message = checkout.state !== 'draft' ? resultMessage(checkout) : valid(checkout) ? prompt(checkout) : 'Your bill is ready, but sandbox sending is unavailable. You can review the saved items here.'
      publish({cart:current,checkout,phase:checkout.state==='draft'?'review':'result',message})
      return message
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Your bill could not be prepared.'
      if (token === operation) publish({error:message,message:'Review your cart and try again.'})
      return message
    } finally { if (token === operation) publish({busy:false}) }
  }

  function confirm() {
    const checkout = state.checkout
    if(checkout && Date.parse(checkout.expires_at) <= Date.now()) {
      const message='This bill has expired. Close checkout and open it again for a fresh bill.'
      publish({message});return message
    }
    if(checkout && !checkout.visa?.ready)return state.message
    if (state.busy || state.phase !== 'review' || !checkout || !valid(checkout) || visibleBill !== identity(checkout))
      return 'Please wait for your current bill to appear, then review it before confirming.'
    approvedBill = identity(checkout)
    const message = 'Please say or enter a fresh six-digit authenticator code. The code is used only to approve this bill.'
    publish({phase:'mfa',message,error:''})
    return message
  }

  async function refresh() {
    if (!state.checkout || state.busy) return
    publish({busy:true,error:''})
    try {
      const checkout = checked(await send(`/api/checkouts/${state.checkout.id}/`)).data as Checkout
      approvedBill = ''; visibleBill = ''
      publish({checkout,phase:checkout.state==='draft'?'review':'result',message:checkout.state==='draft'?prompt(checkout):resultMessage(checkout)})
    } catch { publish({error:'The saved status could not be loaded. Please check again.'}) }
    finally { publish({busy:false}) }
  }

  function resultMessage(checkout: Checkout) {
    return checkout.state === 'accepted' ? 'Your sandbox request was accepted. No payment was charged and no merchant order was created.'
      : 'The request has not been confirmed as accepted. Check its saved status; it will not be sent again automatically.'
  }

  async function submitCode(text: string) {
    const checkout = state.checkout
    if (state.busy) return 'Please wait while your request is being checked.'
    if (state.phase !== 'mfa' || !checkout || !valid(checkout) || approvedBill !== identity(checkout)) {
      approvedBill = ''
      publish({phase:'review',message:'Please review and confirm the current bill again.'})
      return state.message
    }
    const code = authenticatorDigits(text)
    if (!code) { const message='Please say six individual digits or type the six-digit code.'; publish({message}); return message }
    publish({phase:'submitting',busy:true,error:'',message:'Verifying your approval and sending the sandbox request…'})
    try {
      const result = await approveAndSubmitCheckout(checkout,true,code,send)
      publish({checkout:result,phase:'result',message:resultMessage(result)})
    } catch {
      // An interrupted submission may already have reached the service. Read stored
      // state only; never retry the submit request or retain the authenticator code.
      try {
        const saved = checked(await send(`/api/checkouts/${checkout.id}/`)).data as Checkout
        publish({checkout:saved,phase:saved.state==='draft'?'review':'result',message:saved.state==='draft'?'Approval was not completed. Review the bill again and use a fresh authenticator code.':resultMessage(saved)})
      } catch { publish({phase:'result',message:'The result is not confirmed. Check the saved status before taking another action.'}) }
    } finally { approvedBill=''; publish({busy:false}) }
    return state.message
  }

  function close() {
    if (state.busy) return
    if (state.phase==='result' && state.checkout && state.cart) lastResult={checkout:state.checkout,cart:state.cart}
    operation++; visibleBill=''; approvedBill=''; publish(empty())
  }

  return {
    getState: () => state, begin, confirm, submitCode, refresh, close,
    billVisible(id: string, hash: string) { if (state.checkout && id===state.checkout.id && hash===state.checkout.snapshot_hash) visibleBill=identity(state.checkout) },
    async handle(text: string): Promise<string|null> {
      if (!state.open) return authenticatorDigits(text) ? 'Verification is closed. Open your bill to continue.' : null
      if (state.busy) return state.message
      if (/^(?:no(?: thanks)?|cancel|go back|keep editing|not yet)[.!\s]*$/i.test(text.trim())) {
        close(); return 'Back to your room.'
      }
      if (state.phase==='mfa') return submitCode(text)
      if (state.phase==='review' && confirmsVisibleBill(text)) return confirm()
      return state.message || 'Review the bill, then say yes when you are ready.'
    },
  }
}
