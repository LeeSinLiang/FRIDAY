# Account, authenticator, and approved sandbox checkout

Owner: William. Implementation branch: `codex/visa-sandbox`. Updated 2026-09-19.

## Scope and architecture

Implemented locally: account signup, mandatory email verification by expiring code, password login/logout/reset, TOTP enrollment and login, recovery codes, MFA management, immutable sample checkout, transaction-specific MFA approval, and real Visa IDX submission. This worktree now uses Gmail SMTP with the local inbox disabled, replacing Resend's restricted test sender for the demo. William's existing Gmail is the sender; a real verification message arrived in Inbox and its fresh code was accepted in the browser. No separate Gmail account or custom domain was created. No real merchant purchase, payment authorization, or order creation is claimed.

The implementation branch is `codex/visa-sandbox`, based on `main` through `98ca88d`. See the [combined integration handoff](handoffs/visa-auth-integration.md) for the upstream features preserved, current verification, and remaining contracts. Existing Django users remain on the default user model; allauth owns its email/authenticator records. The React screens adapt allauth's official headless example to this project's Vite/TypeScript stack. Credentials, development accounts, and the MFA encryption key are local configuration and are not distributed with the branch.

| Component | Responsibility |
| --- | --- |
| `backend/accounts/adapters.py` | Fernet encryption for allauth TOTP secrets and recovery seeds; private key file required. |
| `backend/accounts/policy.py`, `middleware.py` | Verified-email/enrollment checks, local inbox restrictions, recent MFA for removal/recovery-code replacement, no-store responses. |
| `backend/accounts/models.py`, `email_backend.py`, `views.py` | Session-scoped development mail, account status, local QR rendering. |
| `backend/checkout/catalogue.py` | Two explicit fixture products; no shared catalogue/stock integration. |
| `backend/checkout/models.py`, `serializers.py`, `services.py`, `views.py` | Server-priced snapshot, strict request fields, MFA approval, atomic one-send claim, saved result. |
| `backend/visa/client.py` | Existing fixed Visa sandbox endpoint, X-Pay signing, MLE, response correlation. |
| `frontend/src/auth/flow.ts`, `AccountApp.tsx` | Account steps derived from server state, a ready screen, and a separate security route. |
| `frontend/src/auth/AccountPages.tsx`, `AuthenticatorSetup.tsx` | Sign-in/create-account pages, email and MFA challenges, QR enrollment and recovery-code acknowledgement. |
| `frontend/src/auth/SecuritySettings.tsx` | Account-security management, email reconfirmation and recovery controls. |
| `frontend/src/checkout/` | Product quantities, review, explicit MFA approval, submission, receipt. |

## Setup and normal workflow

**Integration status after the latest main pull:** the new room editor and its proxy configuration are preserved unchanged. The account screens below describe the existing implementation and previously tested workflow, but `/account` and `/checkout` are not yet mounted by that editor. Follow the [UI integration handoff](handoffs/visa-auth-integration.md#ui-integration-instructions-for-the-next-owner) to connect them. The original HTML Visa tester remains directly available on the backend at `/api/visa/sandbox-test/`.

Run `./setup.sh`, then `./run-local.sh` from the worktree root. Setup preserves the existing database and encryption key, applies migrations, creates `friday_cache`, and installs the locked dependencies. The current isolated ports are backend 8001 and frontend 5174; ordinary defaults are 8000/5173.

1. Open `http://127.0.0.1:5174/account/sign-in` for an existing account, or choose **Create a new account** (`/account/create`). `/account` defaults to sign-in when signed out. New accounts provide email, password and password confirmation.
2. With SMTP configured, use the newest verification code from your email, checking Spam as well as Inbox. Codes expire after ten minutes; allauth limits attempts and resends. Resending invalidates the earlier code. In DEBUG installations still using local capture, the page instead says **Check the local test inbox**; refresh it for the code. Captured messages remain visible for thirty minutes but are not internet mail delivery.
3. On **Get your authenticator QR code**, enter your **FRIDAY account password** (the new password if recently reset) and choose **Show setup QR code**. Scan the QR or enter its manual key in a TOTP app, then enter the current six-digit code from the app's FRIDAY entry. Enrollment is only activated after verification. The QR is generated locally; no third-party QR service receives the secret.
4. Save the recovery codes, then choose **I saved my recovery codes — continue**. They are displayed once, and each can be used once. For a lost authenticator, use a recovery code to log in, open **Manage account security**, confirm identity, remove the old authenticator, and enroll another. Checkout is blocked while no authenticator is enrolled.
5. Open `/checkout`. Choose sample quantities, review the server-calculated items/vendor/USD total, explicitly approve, and enter an unused six-digit authenticator code. A code already used to log in cannot immediately approve checkout; wait for the next code.
6. Click **Send approved request to Visa sandbox**. Keep the receipt URL to reload the stored result. A Match Key proves accepted IDX context, not payment approval.

Password reset is available from **Sign in → Forgot password?** or **Reset password** on a pending challenge. Open the reset URL from the email (or local inbox when configured). After saving the new password, the UI clears the older login/email challenge through allauth's session DELETE endpoint and opens sign-in with a success notice. If session cleanup fails after the password was saved, a dedicated success screen provides a retry instead of submitting the consumed reset token again. Changing a password does not remove MFA; the next login still requires an authenticator or unused recovery code.

For an account that completed setup, open **Manage account security** (`/account/security`), expand **Confirm your email address**, choose **Send confirmation email**, and enter the newest message's code. This confirms fresh access to the primary mailbox without deleting the account, resetting its password, removing MFA, or changing its existing verified flag. The current Gmail SMTP check delivered to Inbox and passed confirmation. Earlier Resend checks delivered an initial message to Inbox and a replacement to Spam; the old code was rejected and the latest code succeeded.

Existing-email signup sends an **Account Already Exists** notice while retaining allauth's generic verification response. Use **Back to sign in**, **Create a new account**, or **Reset password** to leave the pending challenge; header Sign in/Create account links also cancel it. Cancellation flushes only the current session attempt and does not verify an email, alter account records, or bypass MFA. The session API normally returns HTTP 401 on successful logout; the frontend additionally checks anonymous state and absence of pending flows before navigation. `HEADLESS_FRONTEND_URLS` must include both `account_reset_password` (request form) and `account_reset_password_from_key` (token form); omitting the former crashes duplicate signup. The reset form remains accessible while verification is pending. A 429 response means to wait before retrying; it does not prove email delivery.

Use the same browser and hostname throughout a local workflow. `localhost` and `127.0.0.1` have separate cookies; the configured `FRONTEND_ORIGIN` for this worktree is `http://127.0.0.1:5174`.

### If no setup QR is visible

Check **Signed in as** in the browser you are using. Chrome and the in-app browser have separate sessions, even at the same localhost URL. Enrolled accounts see **Enter your authenticator code** during login, then **You’re signed in**. A new QR is only needed when connecting an authenticator; recovery management lives on its separate settings page.

For an account showing **Get your authenticator QR code**, enter its password in **FRIDAY account password** and click **Show setup QR code**. The QR appears only after that password check succeeds. The previous wording, **Connect your authenticator / Confirm your password / Set up authenticator**, described the same step without explaining that the QR came next; this was a usability issue, not evidence of a failed enrollment. Do not remove an existing authenticator to resolve a browser/account mix-up. A genuine lost-authenticator case uses the existing recovery flow.

### Why the screens are separate

The original prototype placed enrollment and recovery settings on the same post-login page so each integration could be tested. The refactor makes the next required action explicit: create account → verify email → QR enrollment → save recovery codes → ready. Returning users enter a password, then an authenticator/recovery code, and arrive at the ready screen. An existing unverified account still has to verify email; an existing account without MFA completes enrollment once. Server checks remain authoritative even when a URL is opened directly.

### Temporary local SQL storage

Accounts already persist in the ignored SQLite development file `backend/db.sqlite3`; no plaintext `.sql` export or second account store is needed. `auth_user` stores the email and Django password hash, `account_emailaddress` stores verification status, `mfa_authenticator` stores encrypted authenticator/recovery data, and `django_session` stores sessions. The private encryption key remains in ignored `backend/.runtime/mfa.key`. Keep the key with this database when preserving development accounts.

The file survives browser reloads and server restarts; “temporary” means local development storage, not automatic account deletion at exit. Existing user accounts, email configuration and schema were retained during the UI refactor.

## Routes and security rules

Allauth browser endpoints are under `/_allauth/browser/v1/` (no trailing slash on individual endpoints): `auth/signup`, `auth/login`, `auth/session`, `auth/email/verify`, `auth/email/verify/resend`, `auth/password/request`, `auth/password/reset`, `auth/reauthenticate`, `auth/2fa/authenticate`, `auth/2fa/reauthenticate`, `account/authenticators/totp`, and `account/authenticators/recovery-codes`. Allauth can return HTTP 401 for a successful intermediate operation whose session is still unauthenticated; the frontend interprets authentication state and errors, including password-reset completion.

Our account routes are GET `/api/accounts/status/`, `/api/accounts/local-inbox/`, and `/api/accounts/totp-qr/`, plus POST `/api/accounts/email/confirm/`. The latter consumes allauth's session-bound code only for the authenticated user's already verified primary address, retaining its input validation, expiry, attempt limit and CSRF protection. Normal signup still uses allauth's verification endpoint. Its normal finish method returns no newly verified address for an already verified account, which otherwise causes a headless 500; reconfirmation consumes that challenge without modifying account records. This success is not a replacement for MFA or checkout approval.

The local inbox requires DEBUG, the local mail backend, an enabled flag, a loopback connection/host, and the current browser's unguessable mailbox identifier. It is disabled in the current SMTP runtime. Local test messages are retained for 30 minutes and cleaned on subsequent sends; deleting local test databases remains the user's choice.

Checkout routes:

| Method and path | Contract |
| --- | --- |
| GET `/api/checkouts/catalogue/` | Authenticated, verified, MFA-enrolled account; returns fixture products and Visa readiness. |
| POST `/api/checkouts/` | `{items: [{product_id, quantity}]}`; server determines price, currency, vendor, and transaction ID. |
| GET `/api/checkouts/{id}/` | Owner's stored snapshot/result. |
| POST `/api/checkouts/{id}/approve/` | `{snapshot_hash, approved: true, code}`; verifies fresh TOTP through allauth and stores approval. |
| POST `/api/checkouts/{id}/submit/` | `{snapshot_hash}`; requires unexpired, unconsumed approval for this account and browser session. |

Checkout snapshots expire after 15 minutes; approvals expire after at most five. They are immutable: a different cart creates a separate checkout requiring new approval. Recomputing the digest detects stored snapshot changes. A conditional database update claims submission and consumes approval before network I/O. No automatic retry occurs. A crash/uncertain response remains `submitting` or `transport_unknown` and requires investigation.

Only supported IDX fields are sent. The snapshot supplies the amount, transaction ID, and fixture merchant name. The account number, acquirer, email, and IP remain synthetic fixtures. Account passwords, MFA secrets/codes, and local approval tags never go to Visa.

## Configuration and limits

- `django-allauth[headless,mfa]` is locked to 65.19.4; cryptography is a direct dependency. Browser sessions use HttpOnly cookies and CSRF; no browser local-storage bearer token is used.
- `setup.sh` creates a mode-0600 `backend/.runtime/mfa.key` in an ignored private directory. Preserve this key with the database: replacing it makes existing MFA records unreadable. `MFA_ENCRYPTION_KEY_FILE` can point at an external private file. Deployment requires explicit key and SMTP configuration.
- The shared Django database cache stores rate-limit and used-TOTP markers across local reload workers. Do not clear it during active authentication. This SQLite development configuration has not been qualified for a production multi-host deployment.
- To enable external email: set `EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend`, `EMAIL_HOST`, port/TLS settings, credentials, and a provider-approved `DEFAULT_FROM_EMAIL`; disable `AUTH_LOCAL_INBOX_ENABLED`. Set `FRONTEND_ORIGIN` to the actual public HTTPS origin. Credentials go in private environment configuration only.
- Current demo provider: Gmail STARTTLS, `EMAIL_HOST=smtp.gmail.com`, `EMAIL_PORT=587`, `EMAIL_USE_TLS=true`, the Gmail address as `EMAIL_HOST_USER`, and its app password as `EMAIL_HOST_PASSWORD`. `DEFAULT_FROM_EMAIL` uses `FRIDAY <the-same-Gmail-address>`. William completed Google's identity check; Computer Use created the app password named **FRIDAY HackMIT SMTP**. Private `.env` and runtime credential files are ignored and mode 0600. Google's sending limits apply; no custom domain is needed for this Gmail sender. See [Google app-password guidance](https://support.google.com/accounts/answer/185833).
- Prior Resend mail settings are preserved only for rollback in ignored `backend/.runtime/resend-smtp.json` (mode 0600). They are not loaded by the running app. Domain verification is an optional future Resend migration task, not a prerequisite for the current Gmail setup.
- For Resend, use `EMAIL_HOST=smtp.resend.com`, `EMAIL_PORT=587`, `EMAIL_USE_TLS=true`, `EMAIL_HOST_USER=resend`, and the API key as `EMAIL_HOST_PASSWORD`, with an authorized sender. See [Resend SMTP documentation](https://resend.com/docs/send-with-smtp). Keep local/locmem capture for isolated automated tests. Live acceptance requires a real message received in Gmail and successful submission of that message's code, with expiry/resend/reuse protections preserved. An existing account verified through the local inbox is not evidence of Gmail ownership: use a fresh authorized test account/challenge without resetting or deleting the user's existing account.
- The new UI needs a `/_allauth` proxy alongside its existing `/api` proxy. Production hosting must implement both routes and HTTPS; Vite's proxy is not included in `dist`. The deployment itself is not part of this local deliverable.
- Replace the fixture catalogue only after agreeing on the team's product/cart contract. The new room editor is unchanged and account navigation is pending integration. The separate Visa HTML tester remains available unchanged. Scene records currently belong to a browser session key; guest-room transfer through login/logout still needs an explicit ownership contract.

## Verification

Final branch verification on `98ca88d`: the backend suite ran 153 tests with five catalogue cache/test compatibility failures and one optional live test skipped; the other tests passed. The 27 scene tests, 9 auth tests, migration checks and production build passed. See the [integration handoff](handoffs/visa-auth-integration.md#verification) for the failure explanation, unchanged tester checks, and pending UI wiring. The provider, phone, and Visa results below were obtained in earlier workflow checks; pulling the latest code did not send another email or IDX request.

Authenticator workflow diagnosis ([issue #12](https://github.com/LeeSinLiang/hackmit2026/issues/12)): the no-QR screenshot was the password confirmation step, with unclear copy; no failed enrollment was reproduced. The revised heading, FRIDAY password label and **Show setup QR code** action explain the sequence. An isolated Chrome signup/email-verification replay checked wrong/correct passwords, loaded QR, wrong/correct activation codes, ten recovery codes, acknowledgement, logout and returning password/MFA login. Separately, a current FRIDAY code read through iPhone Mirroring was accepted by the user's signed-in Chrome security page. This verifies the existing phone enrollment against the server; the agent did not replay the user's initial camera scan. All 15 account tests and 9 frontend tests passed, plus the production build. After canonical restart, the served source exactly matched the edited file and the user's session returned to the ready screen; account, email, authenticator and encryption-key fingerprints were unchanged.

Verification-navigation fix ([issue #10](https://github.com/LeeSinLiang/hackmit2026/issues/10)): reproduced the exact pending duplicate-signup verification → password reset → contradictory verification screen in Chrome against a disposable SQLite/local-mail instance. Before the fix, the header Sign in link also looped back into verification. After the fix, the same reset sequence returned to sign-in with its success notice and accepted the new password. Back to sign in and Create a new account cancelled pending challenges; a subsequent login to an unverified account still required verification. All 15 account tests and 9 frontend tests passed, along with Django checks and the production build. Real Gmail SMTP and the user's account were untouched; the existing rate limits remained active during browser testing.

Latest provider configuration check: Gmail SMTP authentication returned 235, the running app sent a real confirmation email that reached William's Gmail Inbox, and the browser accepted that code. Django checks, frontend build, whitespace checks and credential scans passed. The canonical 5174/8001 stack was restarted and its process paths verified; the separate 5173/8000 stack was preserved. No authentication code changed during this provider switch, so its existing 13 account tests and 3 API-error tests were not rerun. Delivery to other recipients was not directly exercised. See TODO_WILLIAM.md for detailed evidence.

Run from the root:

```bash
(cd backend && OPENAI_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test api catalogue visa accounts checkout)
(cd backend && uv run python manage.py check)
(cd backend && uv run python manage.py makemigrations --check --dry-run)
(cd frontend && npm run build)
(cd frontend && npm test)
(cd frontend && node --experimental-strip-types --test src/auth/api.test.mjs src/auth/flow.test.mjs)
```

Backend tests cover mandatory verification, duplicate signup with an existing account, bad/expired/used codes, CSRF, encryption at rest, recovery single use/display policy, password reset preserving MFA, local-inbox isolation, server prices, account/session ownership, explicit consent, expired/tampered approvals, duplicate sends, and uncertain outcomes. API-client tests cover status-only rate limits, server failures, and specific validation/identity errors. Unit tests mock Visa transport; the live account checkout receipt is separate evidence in [account-checkout-2026-09-19.json](evidence/account-checkout-2026-09-19.json).

Latest UI-refactor run: all 36 backend tests and 7 frontend API/routing tests passed. Django checks, migration drift checks and TypeScript/Vite build passed with only the existing Three.js bundle-size warning. Chrome verified separate sign-in/create/reset pages, rejection of an incorrect MFA code, returning-account MFA login, separate management, QR enrollment and recovery-code acknowledgement on the disposable workflow account, and checkout access. After the canonical `./run-local.sh` restart, all six served auth module source maps matched current files, and password/MFA login still worked. Account/verification/authenticator records and the encryption key matched their pre-restart digests. No new SMTP or Visa request was needed for this UI-only change. Launcher port checks allow closed TIME_WAIT sockets while continuing to reject active listeners.

Browser checks use real signup, local mail, verification, enrollment, MFA login and checkout controls. Disposable test-account TOTP codes are generated independently from the displayed enrollment secret using RFC 6238. The latest phone check additionally used the actual FRIDAY entry through iPhone Mirroring, as described above. No bypass code or pre-marked verified account is used for the browser workflow. See TODO_WILLIAM.md for final run results and runtime identity.

## Build references

- [Allauth React example and README](https://github.com/pennersr/django-allauth/tree/main/examples/react-spa)
- [Official API wrapper](https://github.com/pennersr/django-allauth/blob/main/examples/react-spa/frontend/src/lib/allauth.js)
- [Headless installation](https://docs.allauth.org/en/latest/headless/installation.html), [account configuration](https://docs.allauth.org/en/latest/account/configuration.html)
- [MFA forms](https://docs.allauth.org/en/latest/mfa/forms.html), [encryption adapter](https://docs.allauth.org/en/latest/mfa/adapter.html)
- [OWASP transaction authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html)
