import type { Checkout } from './types'

type ApiResult = { status: number; data?: unknown; errors?: { message: string }[] }
type Requester = (path: string, method: string, body: unknown) => Promise<ApiResult>

function success(result: ApiResult) {
  if (result.status >= 400) throw new Error(result.errors?.map(error => error.message).join(' ') || 'This action could not be completed. Try again.')
}

/** One explicit click consumes MFA approval and sends one sandbox request, in order. */
export async function approveAndSubmitCheckout(
  checkout: Checkout,
  confirmed: boolean,
  code: string,
  send: Requester,
): Promise<Checkout> {
  const approval = await send(`/api/checkouts/${checkout.id}/approve/`, 'POST', {
    snapshot_hash: checkout.snapshot_hash,
    approved: confirmed,
    code,
  })
  success(approval)
  const approved = approval.data as Checkout
  const submission = await send(`/api/checkouts/${approved.id}/submit/`, 'POST', {
    snapshot_hash: approved.snapshot_hash,
  })
  success(submission)
  return submission.data as Checkout
}
