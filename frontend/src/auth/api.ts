export type ApiResult = {
  status: number
  data?: any
  meta?: { is_authenticated?: boolean; secret?: string; totp_url?: string }
  errors?: { message: string; param?: string }[]
}

export async function request(path: string, method = 'GET', data?: unknown): Promise<ApiResult> {
  const csrf = document.cookie.split('; ').find(value => value.startsWith('csrftoken='))?.split('=').slice(1).join('=')
  const response = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRFToken': decodeURIComponent(csrf) } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const json = await response.json().catch(() => ({ errors: [{ message: 'The server could not complete this request. Reload and try again.' }] }))
  return { ...json, status: response.status }
}

export const auth = (path: string, method = 'GET', data?: unknown) => request('/_allauth/browser/v1/' + path, method, data)

export type AuthDestination = '/account/sign-in' | '/account/create' | '/account?mode=reset' | '/account/sign-in?reset_done=1'

export async function clearAuthSession() {
  const result = await auth('auth/session', 'DELETE')
  // allauth returns 401 after a successful logout because the session is now anonymous.
  const cleared = [200, 401].includes(result.status) && result.meta?.is_authenticated === false
    && !result.errors?.length && !result.data?.flows?.some((flow: { is_pending?: boolean }) => flow.is_pending)
  if (!cleared) {
    if (result.status !== 401) assertSuccess(result)
    throw new Error('Could not clear the previous sign-in attempt. Please try again.')
  }
}

export async function restartAuth(destination: AuthDestination) {
  await clearAuthSession()
  location.assign(destination)
}

export function assertSuccess(result: ApiResult) {
  if (result.status === 429) throw new Error('Too many attempts. Wait a few minutes before trying again.')
  if (result.status >= 500) throw new Error('The account service encountered an error. Wait a moment and try again. If it keeps happening, contact the project team.')
  if (result.status === 401 && result.meta?.is_authenticated) throw new Error('Please confirm your identity in security settings, then try this action again.')
  if (result.status >= 400) throw new Error(result.errors?.map(e => e.message).join(' ') || result.data?.error || 'This action could not be completed. Try again.')
}
