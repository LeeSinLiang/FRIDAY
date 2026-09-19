import { useState } from 'react'
import { assertSuccess, request } from './api'

export default function LocalInbox({ verificationPending = false }: { verificationPending?: boolean }) {
  const [messages, setMessages] = useState<{ id: string; subject: string; body: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function refresh() {
    setBusy(true)
    try { const result = await request('/api/accounts/local-inbox/'); assertSuccess(result); setMessages((result as any).messages); setError('') }
    catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <details className="local-inbox" open={verificationPending}>
    <summary>Local test inbox</summary>
    <p>Messages for this browser session only. Nothing is delivered to an external mailbox. Messages remain here for 30 minutes; verification codes expire after 10 minutes.</p>
    <button type="button" className="secondary" disabled={busy} onClick={refresh}>{busy ? 'Loading messages…' : 'Refresh inbox'}</button>
    {error && <p role="alert">{error}</p>}
    {messages.length === 0 && <p>No messages loaded. Request an email, then refresh.</p>}
    {messages.map(message => <article key={message.id}><h3>{message.subject}</h3><pre>{message.body}</pre></article>)}
  </details>
}
