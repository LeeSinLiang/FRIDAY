import type { Checkout } from './types'

export default function SandboxReceipt({ checkout }: { checkout: Checkout }) {
  const evidence = checkout.evidence
  return <section className="sandbox-receipt" aria-label="Sandbox receipt">
    <h2>{checkout.state === 'accepted' ? 'Visa IDX accepted this request' : checkout.state === 'submitting' ? 'Submission in progress or awaiting confirmation' : 'Submission did not produce an accepted result'}</h2>
    <p>{evidence.message || 'Refresh this saved checkout for its latest status. Do not submit another request automatically.'}</p>
    <dl><dt>State</dt><dd>{checkout.state}</dd><dt>Transaction ID</dt><dd><code>{checkout.trans_id}</code></dd>
      {evidence.http_status && <><dt>Visa HTTP response</dt><dd>{evidence.http_status}</dd></>}
      {evidence.response?.idxMatchKey && <><dt>IDX Match Key</dt><dd><code>{evidence.response.idxMatchKey}</code></dd></>}
      {evidence.response_encrypted !== undefined && <><dt>Encrypted response verified</dt><dd>{evidence.response_encrypted ? 'Yes' : 'No'}</dd></>}
      {evidence.transaction_id_matches !== undefined && <><dt>Transaction ID matches</dt><dd>{evidence.transaction_id_matches ? 'Yes' : 'No'}</dd></>}
    </dl>
    {evidence.response?.warningMessages?.map(message => <p key={message}>{message}</p>)}
    <p><strong>Payment authorization: not attempted. Vendor order: not created.</strong></p>
  </section>
}
