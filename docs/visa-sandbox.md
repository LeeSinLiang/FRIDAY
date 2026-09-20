# Visa IDX sandbox tester and commerce integration plan

Owner: William. Branch: `codex/visa-sandbox`. Updated: 2026-09-19.

## Delivered scope and current evidence

The standalone HTML tester sends synthetic data through Django to the actual Visa IDX sandbox. It validates a supported subset of IDX v1, records the exact approved payload hash, signs the encrypted request with X-Pay, decrypts the response, and checks the returned transaction ID and Match Key. It has no payment authorization, capture, refund, or vendor-order operation.

Two live calls on 2026-09-19 returned HTTP 200, encrypted responses, matching transaction IDs, and Match Keys. The first did not request DCAP. The second requested DCAP and returned `dcapIndicator: 1` (not eligible) with `DCAP Acquirer check failed for acquirer region VE.` IDX acceptance and DCAP eligibility are separate results. See [sanitized evidence](evidence/visa-idx-2026-09-19.json).

The portal showed IDX SUCCESS, mandatory encryption, one active inbound X-Pay credential, and an active MLE certificate. William approved registering a dedicated public wrapping key to retrieve the existing encrypted X-Pay secret. The corresponding private key and decrypted secret are stored in a private directory outside Git. The downloaded MLE private key was one line; a normalized local copy was verified against the active client certificate. The original download was preserved.

**Account implementation available for UI integration:** signup, mandatory email verification through a private local inbox or configured SMTP, authenticator enrollment/login/recovery, and checkout-specific MFA approval. Gmail delivery and a phone-generated FRIDAY code were verified in the earlier account workflow. See [account and checkout workflow](account-mfa-checkout.md) and the [latest-main integration handoff](handoffs/visa-auth-integration.md). The new room editor is preserved unchanged; mounting these account/checkout screens is a handoff task. The standalone HTML tester is also preserved unchanged as a separate developer fixture with a checkbox, not an MFA flow. Shared catalogue/cart integration, payment authorization, and merchant ordering remain unimplemented.

## Launch and configuration

Canonical source for this isolated tester: `/Users/williamxu/.codex/worktrees/visa-sandbox/hackmit2026`. The user's main checkout has unrelated Kanban work and its own development servers. Only this isolated checkout currently implements the IDX tester. Do not switch or overwrite the main checkout to run it.

Run `./setup.sh` after first checkout or dependency/migration changes, then `./run-local.sh`. This is the normal launch path; both servers stop together on Ctrl-C.

Current isolated configuration uses backend port 8001 and frontend port 5174. Open:

- Frontend proxy: <http://127.0.0.1:5174/api/visa/sandbox-test/>
- Direct Django route: <http://127.0.0.1:8001/api/visa/sandbox-test/>

The HTML template lives at `backend/visa/templates/visa/sandbox_test.html`. It must be served by Django, not opened as a `file://` page: CSRF tokens, session ownership, and credentials are supplied by the backend.

The `.env` template contains two opt-in settings:

```dotenv
VISA_SANDBOX_TESTER_ENABLED=true
VISA_SANDBOX_CREDENTIALS_FILE=/absolute/private/path/credentials.json
```

The credential JSON requires `api_key`, `shared_secret`, `mle_key_id`, `server_certificate`, and `client_private_key`. The last two are absolute PEM file paths. Keep the containing directory mode 0700 and secret/private-key files mode 0600. Do not put secrets in HTML, frontend environment variables, screenshots, reports, Git, or command arguments. The current private directory is `/Users/williamxu/.config/hackmit2026/visa-sandbox/`.

The tester requires `DEBUG=true`, the explicit enable flag, a loopback request, and a localhost/127.0.0.1 Host. It retains Django CSRF protection. The configured local frontend origin is trusted only in DEBUG for Vite's proxy. This harness is not a production authentication surface; disable it for deployment and never expose it through a tunnel or reverse proxy.

## Implemented request and evidence contract

All paths below are under `/api/visa/sandbox-test/`.

| Method / route | Behavior |
| --- | --- |
| GET `/` | Serve the HTML tester and CSRF token. |
| GET `bootstrap/` | Check private configuration, create a browser session if needed, generate a fresh synthetic fixture, and report current source path/hash. Never send Visa a request. |
| POST `validate/` | Accept `{payload: object}`, reject unsupported tags/types/values, and store an immutable five-minute sample with a payload hash. Return a masked review snapshot. |
| POST `submit/` | Require `{attempt_id, payload_hash, approved: true}` for this session. Atomically claim an unused attempt, then perform at most one outbound call. |
| GET `attempts/<uuid>/` | Return persisted, sanitized evidence belonging to the current session. |

`SandboxAttempt` stores the session key, unique transaction UUID, synthetic payload, payload hash, state, evidence, and timestamps. It does not store Visa API credentials. All account numbers accepted by this tester are the two public documentation examples; real account data and arbitrary email/IP values are rejected. This is intentional scope, not a full general IDX validator.

| Required IDX field | Mapping and local validation |
| --- | --- |
| `acctNumber` | Public reference fixture `4005529999000123` or `4111111111111111`; only the first has been live-verified here. Mask in output evidence. |
| `acquirerBIN` | Numeric string, 6–11 digits. The tested fixture uses `438309`; DCAP eligibility is not established for it. |
| `purchaseAmount` | Numeric string in minor units. This harness limits values to 1–1000000; tested value `12550`. |
| `purchaseCurrency` | This harness supports numeric currency string `840` (USD). |
| `purchaseExponent` | String `2` for the supported USD fixture. |
| `purchaseDate` | UTC `YYYYMMDDHHMMSS`, within five minutes of server time. |
| `transID` | Canonical UUID; uniqueness enforced in the database. |

Supported optional fields: `merchantID`, `merchantName`, `mcc`, `deviceChannel`, `productType`, `transType`, `messageCategory`, `browserIP`, `email`, and `requestDCAPStatus`. The synthetic baseline includes browser channel `02`, physical product type `02`, regular transaction `01`, payment-context message category `01`, documentation IP `192.0.2.1`, and email `sandbox@example.com`. The payment-context tag does not execute a payment. The merchant/category values are test fixtures, not real merchant enrollment or acquirer routing evidence.

Do not add invented `mfaVerified` or `emailVerified` properties to an IDX payload. Record local security evidence separately unless Visa's implementation guide specifies an appropriate supported mapping. Do not invent a risk score or claim app TOTP is issuer/3DS authentication.

Outbound URL is fixed to `https://sandbox.api.visa.com/vidx/v1/requests`; callers cannot provide URLs. The live-verified X-Pay signing resource is `v1/requests`, omitting the `vidx` context. Query string includes `apikey`. MLE uses RSA-OAEP-256 and A128GCM, protected `kid` and millisecond `iat`, and an `encData` envelope. X-Pay signs the final serialized encrypted body. HTTP redirects, environment proxies, and automatic retries are disabled; TLS certificate verification remains enabled.

An `accepted` result requires HTTP 200, successful MLE decryption, a valid-length Match Key, and an exact transaction-ID match. Unencrypted or mismatched-ID successes are `unverified_response`; bad encryption/schema is `invalid_response`; upstream errors are `rejected`; transport failure is `transport_unknown`. The latter means receipt is unknown and must not be automatically retried. A crash after claiming an attempt can leave it `submitting`; investigate before creating another attempt.

Evidence includes the masked submitted fields, plaintext payload hash, encrypted request hash, HTTP status, allowed correlation headers, latency, response encryption status, transaction-ID comparison, Match Key, DCAP indicator, and warnings. DCAP `1` means not eligible; `2` means eligible. No returned DCAP indicator means no result was returned, not an eligibility decision.

This proves Visa accepted an encrypted request for the matching transaction and returned a Match Key. It cannot independently expose Visa's internal stored fields, issuer processing, or the effect of each optional tag. Local field validation and sent-payload evidence must not be described as upstream storage inspection.

## Account workflow and remaining commerce integration

The earlier custom email/PyOTP proposal is superseded by django-allauth headless and MFA. See [implemented account architecture, routes, setup, tests, and limitations](account-mfa-checkout.md). Account verification uses expiring codes; the library owns authentication and recovery records. Our adapter encrypts its TOTP secret and recovery seed. Application checkout approvals are separate, server-owned records.

The account checkout uses an explicit two-product fixture catalogue. Replace `checkout/catalogue.py` with the team's authoritative catalogue/cart contract before claiming real product prices or stock validation. The backend already calculates totals in integer minor units and maps the approved snapshot amount and transaction ID to the tested IDX client. Each checkout is immutable; different items create a separate checkout requiring a new approval.

A third real IDX call through the authenticated account/MFA checkout returned HTTP 200 and a matching encrypted result for a synthetic USD 504.00 total. See [sanitized account checkout evidence](evidence/account-checkout-2026-09-19.json). Account identifiers, passwords, and MFA codes were not sent to Visa; the existing synthetic email/IP/account fixtures were retained.

Payment authorization remains a separate, unimplemented integration. A gateway/acquirer must support transmitting the IDX Match Key in its authorization message. Merchant ordering needs a separate merchant API and actual order ID. Neither action is authorized or implemented by this sandbox workflow.

## Verification and handoff requirements

Automated checks: `cd backend && uv run python manage.py test api visa`, `uv run python manage.py check`, `uv run python manage.py makemigrations --check --dry-run`; frontend build: `cd frontend && npm run build`. Fourteen tests passed, including HMAC known-vector/body binding, JWE round trip/tampering, correlated responses, rejection/timeout handling, strict payload fields/types, local/debug gates, CSRF, explicit approval, payload hash, expiration, session isolation, and repeated-submit protection. These automated transport tests use generated keys and mocked HTTP; the two saved live receipts provide separate sandbox evidence.

Browser verification: normal full-stack launch, configuration readiness, unknown `mfaVerified` tag rejected before sending, fresh sample validation, explicit approval, two real submissions, and saved evidence rendering. A persisted receipt survived reload, a new sample cleared prior success, and editing approved JSON disabled submission. Visual inspection and browser console checks passed. The existing Three.js build emits its pre-existing chunk-size warning.

For runtime freshness, use the one sandbox tester instance from the isolated source above. The main project servers on 8000/5173 are separate ongoing work and do not contain this tester. Confirm the tester listeners and process working directories, compare `bootstrap/` source path/hash to this checkout, and open the exact served page in Chrome. Do not infer delivery from tests alone. The change remains on the isolated feature branch until reviewed/integrated; no commit or push is performed automatically.

At handoff, backend 8001 and frontend 5174 process working directories matched this checkout; both direct and proxied bootstrap responses matched source SHA-256 `dbb448fea881aab1fee800168e37ad86d027237f0ca2e420a4bd9e73e01042b8`. An exact-value scan found no API key, shared secret, or private-key material in tracked/trackable source and evidence files.

Update this document and `TODO_WILLIAM.md` when work changes status. Keep the future plan distinct from completed work. Preserve the main checkout's Kanban edits; any board entry should distinguish the verified local account/MFA and IDX sandbox flow from external email, shared catalogue/cart, payment, and order work that remains pending.

## Primary references

- [Project sandbox](https://developer.visa.com/portal/app/v2/79f58873-2306-431a-9479-6e5d23df5ef1/SBX)
- [IDX API reference](https://developer.visa.com/capabilities/visa-intelligent-data-exchange-api/reference)
- [IDX authentication and required MLE](https://developer.visa.com/capabilities/visa-intelligent-data-exchange-api/docs-authentication)
- [IDX data flow and Match Key in authorization](https://developer.visa.com/capabilities/visa-intelligent-data-exchange-api/docs-how-to)
- [X-Pay signing and shared-secret retrieval](https://developer.visa.com/pages/working-with-visa-apis/x-pay-token)
- [Visa MLE guide and Python example](https://developer.visa.com/pages/encryption_guide)
- [JWCrypto JWE](https://jwcrypto.readthedocs.io/en/latest/jwe.html)
- [Django authentication](https://docs.djangoproject.com/en/5.2/topics/auth/default/), [signing](https://docs.djangoproject.com/en/5.2/topics/signing/), [email](https://docs.djangoproject.com/en/5.2/topics/email/)
- [PyOTP](https://pyauth.github.io/pyotp/)
- [OWASP transaction authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html)
