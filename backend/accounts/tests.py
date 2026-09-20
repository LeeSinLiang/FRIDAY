import base64
import hashlib
import hmac
import re
import struct
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from allauth.account.models import EmailAddress
from allauth.account import app_settings as account_settings
from allauth.mfa.models import Authenticator

AUTH = "/_allauth/browser/v1/"
PASSWORD = "Test-only Cedar River 942!"


def totp(secret, offset=0):
    """Independent RFC 6238 calculation, not the implementation under test."""
    counter = int(time.time() + offset) // 30
    digest = hmac.new(base64.b32decode(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    start = digest[-1] & 15
    return f"{(struct.unpack('>I', digest[start:start + 4])[0] & 0x7fffffff) % 1000000:06d}"


# MFA_TOTP_TOLERANCE=1, IN TESTS ONLY: totp() below reads the wall clock and the server reads it again a few
# milliseconds later. When a 30-second window ends between the two, the code is one step old and is refused,
# which failed the suite about once in fifty runs. Production keeps allauth's default of 0. See test_totp_boundary.py.
@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", MFA_TOTP_TOLERANCE=1)
class AccountTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        key = Path(self.directory.name) / "mfa.key"
        key.write_bytes(Fernet.generate_key())
        key.chmod(0o600)
        self.options = override_settings(MFA_ENCRYPTION_KEY_FILE=key)
        self.options.enable()
        self.addCleanup(self.options.disable)
        self.client = Client(enforce_csrf_checks=True)
        self.client.get("/api/accounts/status/")

    def request(self, path, data=None, method="post", client=None):
        client = client or self.client
        return getattr(client, method)(AUTH + path, data=data or {}, content_type="application/json",
                                       HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)

    def signup(self, email="workflow@example.com"):
        result = self.request("auth/signup", {"email": email, "password": PASSWORD})
        self.assertEqual(result.status_code, 401, result.content)
        return re.search(r"(?m)^[A-Z0-9-]{6,}$", mail.outbox[-1].body).group()

    def verified(self):
        code = self.signup()
        result = self.request("auth/email/verify", {"key": code})
        self.assertEqual(result.status_code, 200, result.content)
        return get_user_model().objects.get(email="workflow@example.com")

    def enrolled(self):
        user = self.verified()
        self.assertEqual(self.request("auth/reauthenticate", {"password": PASSWORD}).status_code, 200)
        response = self.client.get(AUTH + "account/authenticators/totp")
        self.assertEqual(response.status_code, 404)
        secret = response.json()["meta"]["secret"]
        self.assertEqual(self.client.get("/api/accounts/totp-qr/").status_code, 200)
        response = self.request("account/authenticators/totp", {"code": totp(secret)})
        self.assertEqual(response.status_code, 200, response.content)
        return user, secret


class AccountWorkflowTests(AccountTestCase):
    def confirm_existing_email(self, code, client=None):
        client = client or self.client
        return client.post('/api/accounts/email/confirm/', {'key': code}, content_type='application/json',
                           HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)

    def test_existing_account_email_confirmation_preserves_password_and_mfa(self):
        user, _ = self.enrolled()
        password = user.password
        authenticators = list(Authenticator.objects.filter(user=user).values())
        with patch('time.time', return_value=time.time() + 61):
            response = self.request('account/email', {'email': user.email}, method='put')
            self.assertEqual(response.status_code, 200, response.content)
            code = re.search(r'(?m)^[A-Z0-9-]{6,}$', mail.outbox[-1].body).group()
            self.assertEqual(self.confirm_existing_email('wrong').status_code, 400)
            self.assertEqual(self.client.post('/api/accounts/email/confirm/', {'key': code}, content_type='application/json').status_code, 403)
            other = Client(enforce_csrf_checks=True)
            other.get('/api/accounts/status/')
            self.assertEqual(self.confirm_existing_email(code, other).status_code, 401)
            other.force_login(user)
            self.assertEqual(self.confirm_existing_email(code, other).status_code, 409)
            self.assertEqual(self.confirm_existing_email(code).status_code, 200)
            self.assertEqual(self.confirm_existing_email(code).status_code, 409)
        user.refresh_from_db()
        self.assertEqual(user.password, password)
        self.assertEqual(list(Authenticator.objects.filter(user=user).values()), authenticators)
        self.assertTrue(self.client.get('/api/accounts/status/').json()['checkout_ready'])

    def test_existing_email_confirmation_resend_expiry_and_attempt_limit(self):
        user = self.verified()
        now = time.time()
        with patch('time.time', return_value=now + 61):
            self.assertEqual(self.request('account/email', {'email': user.email}, method='put').status_code, 200)
            old_code = re.search(r'(?m)^[A-Z0-9-]{6,}$', mail.outbox[-1].body).group()
        with patch('time.time', return_value=now + 122):
            self.assertEqual(self.request('account/email', {'email': user.email}, method='put').status_code, 200)
            new_code = re.search(r'(?m)^[A-Z0-9-]{6,}$', mail.outbox[-1].body).group()
            self.assertEqual(self.confirm_existing_email(old_code).status_code, 400)
        with patch('time.time', return_value=now + 723):
            self.assertEqual(self.confirm_existing_email(new_code).status_code, 409)
            self.assertEqual(self.request('account/email', {'email': user.email}, method='put').status_code, 200)
            code = re.search(r'(?m)^[A-Z0-9-]{6,}$', mail.outbox[-1].body).group()
            for _ in range(account_settings.EMAIL_VERIFICATION_BY_CODE_MAX_ATTEMPTS):
                self.assertEqual(self.confirm_existing_email('wrong').status_code, 400)
            self.assertEqual(self.confirm_existing_email(code).status_code, 409)
        self.assertTrue(self.client.get('/api/accounts/status/').json()['email_verified'])

    def test_existing_email_signup_sends_reset_route_without_changing_account(self):
        user = self.verified()
        original_password = user.password
        self.request("auth/session", method="delete")
        # A later signup attempt, after the first verification-mail cooldown.
        with patch("time.time", return_value=time.time() + 61):
            result = self.request("auth/signup", {"email": user.email, "password": PASSWORD + " duplicate"})
        self.assertEqual(result.status_code, 401, result.content)
        self.assertTrue(any(flow["id"] == "verify_email" and flow.get("is_pending")
                            for flow in result.json()["data"]["flows"]))
        self.assertIn(settings.HEADLESS_FRONTEND_URLS["account_reset_password"], mail.outbox[-1].body)
        self.assertEqual(get_user_model().objects.filter(email=user.email).count(), 1)
        user.refresh_from_db()
        self.assertEqual(user.password, original_password)
        self.assertFalse(self.client.get("/api/accounts/status/").json()["authenticated"])

    def test_signup_requires_email_verification_and_consumes_code(self):
        code = self.signup()
        self.assertFalse(self.client.get("/api/accounts/status/").json()["authenticated"])
        self.assertEqual(self.request("auth/email/verify", {"key": "wrong"}).status_code, 400)
        self.assertEqual(self.request("auth/email/verify", {"key": code}).status_code, 200)
        self.assertEqual(self.request("auth/email/verify", {"key": code}).status_code, 409)
        self.assertTrue(EmailAddress.objects.get(email="workflow@example.com").verified)

    def test_email_code_expiry(self):
        code = self.signup()
        with patch("time.time", return_value=time.time() + 700):
            self.assertEqual(self.request("auth/email/verify", {"key": code}).status_code, 409)
        self.assertFalse(EmailAddress.objects.get(email="workflow@example.com").verified)

    def test_unverified_cannot_enroll(self):
        self.signup()
        self.assertEqual(self.client.get(AUTH + "account/authenticators/totp").status_code, 401)

    def test_csrf_required(self):
        response = self.client.post(AUTH + "auth/signup", {"email": "csrf@example.com", "password": PASSWORD}, content_type="application/json")
        self.assertEqual(response.status_code, 403)

    def test_enrollment_encrypts_secret_and_requires_valid_code(self):
        self.verified()
        self.request("auth/reauthenticate", {"password": PASSWORD})
        secret = self.client.get(AUTH + "account/authenticators/totp").json()["meta"]["secret"]
        self.assertEqual(self.request("account/authenticators/totp", {"code": "wrong"}).status_code, 400)
        self.assertFalse(Authenticator.objects.exists())
        self.assertEqual(self.request("account/authenticators/totp", {"code": totp(secret)}).status_code, 200)
        record = Authenticator.objects.get(type="totp")
        self.assertNotIn(secret, str(record.data))
        from .adapters import cipher
        self.assertEqual(cipher().decrypt(record.data["secret"].encode()).decode(), secret)

    def test_mfa_login_rejects_expired_and_reused_codes_and_logout(self):
        user, secret = self.enrolled()
        self.request("auth/session", method="delete")
        response = self.request("auth/login", {"email": user.email, "password": PASSWORD})
        self.assertEqual(response.status_code, 401)
        self.assertFalse(self.client.get("/api/accounts/status/").json()["authenticated"])
        self.assertEqual(self.request("auth/2fa/authenticate", {"code": totp(secret, -120)}).status_code, 400)
        code = totp(secret)  # the SAME code is replayed below; recomputing it could cross into a new window and be valid
        self.assertEqual(self.request("auth/2fa/authenticate", {"code": code}).status_code, 200)
        self.assertTrue(self.client.get("/api/accounts/status/").json()["checkout_ready"])
        self.request("auth/session", method="delete")
        self.request("auth/login", {"email": user.email, "password": PASSWORD})
        self.assertEqual(self.request("auth/2fa/authenticate", {"code": code}).status_code, 400)

    def test_recovery_codes_show_once_and_are_single_use(self):
        user, _ = self.enrolled()
        url = AUTH + "account/authenticators/recovery-codes"
        codes = self.client.get(url).json()["data"]["unused_codes"]
        self.assertNotIn("unused_codes", self.client.get(url).json()["data"])
        self.request("auth/session", method="delete")
        self.request("auth/login", {"email": user.email, "password": PASSWORD})
        self.assertEqual(self.request("auth/2fa/authenticate", {"code": codes[0]}).status_code, 200)
        self.request("auth/session", method="delete")
        self.request("auth/login", {"email": user.email, "password": PASSWORD})
        self.assertEqual(self.request("auth/2fa/authenticate", {"code": codes[0]}).status_code, 400)

    def test_mfa_removal_requires_recent_mfa(self):
        self.enrolled()
        self.assertEqual(self.request("account/authenticators/totp", method="delete").status_code, 403)

    def test_password_reset_does_not_bypass_mfa(self):
        user, secret = self.enrolled()
        self.request("auth/session", method="delete")
        self.assertEqual(self.request("auth/password/request", {"email": user.email}).status_code, 200)
        key = re.search(r"[?]reset=([^\s]+)", mail.outbox[-1].body).group(1)
        new = "Changed-only Orchard Lake 581!"
        self.assertIn(self.request("auth/password/reset", {"key": key, "password": new}).status_code, (200, 401))
        self.assertFalse(self.client.get("/api/accounts/status/").json()["authenticated"])
        self.assertEqual(self.request("auth/login", {"email": user.email, "password": new}).status_code, 401)
        self.assertEqual(self.request("auth/2fa/authenticate", {"code": totp(secret)}).status_code, 200)

    def test_reset_with_pending_duplicate_signup_can_restart_login_without_losing_mfa(self):
        user, _ = self.enrolled()
        authenticators = list(Authenticator.objects.filter(user=user).values())
        self.request("auth/session", method="delete")
        with patch("time.time", return_value=time.time() + 61):
            result = self.request("auth/signup", {"email": user.email, "password": PASSWORD})
            self.assertEqual(result.status_code, 401)
            self.assertTrue(any(f.get("is_pending") and f["id"] == "verify_email" for f in result.json()["data"]["flows"]))
            self.assertEqual(self.request("auth/password/request", {"email": user.email}).status_code, 200)
            key = re.search(r"[?]reset=([^\s]+)", mail.outbox[-1].body).group(1)
            changed = "Reset regression Maple River 527!"
            result = self.request("auth/password/reset", {"key": key, "password": changed})
            self.assertEqual(result.status_code, 401)
            # This lingering flow caused the screenshot's contradictory UI.
            self.assertTrue(any(f.get("is_pending") and f["id"] == "verify_email" for f in result.json()["data"]["flows"]))
            cleared = self.request("auth/session", method="delete")
            self.assertEqual(cleared.status_code, 401)
            self.assertFalse(cleared.json()["meta"]["is_authenticated"])
            self.assertFalse(any(f.get("is_pending") for f in cleared.json()["data"]["flows"]))
            result = self.request("auth/login", {"email": user.email, "password": changed})
            self.assertEqual(result.status_code, 401)
            self.assertTrue(any(f.get("is_pending") and f["id"] == "mfa_authenticate" for f in result.json()["data"]["flows"]))
        user.refresh_from_db()
        self.assertTrue(user.check_password(changed))
        self.assertTrue(EmailAddress.objects.get(user=user).verified)
        self.assertEqual(list(Authenticator.objects.filter(user=user).values()), authenticators)

    def test_cancelling_verification_requires_csrf_and_does_not_verify_account(self):
        code = self.signup()
        self.assertEqual(self.client.delete(AUTH + "auth/session").status_code, 403)
        cleared = self.request("auth/session", method="delete")
        self.assertEqual(cleared.status_code, 401)
        self.assertFalse(any(f.get("is_pending") for f in cleared.json()["data"]["flows"]))
        self.assertFalse(EmailAddress.objects.get(email="workflow@example.com").verified)
        self.assertEqual(self.request("auth/email/verify", {"key": code}).status_code, 409)
        with patch("time.time", return_value=time.time() + 61):
            response = self.request("auth/login", {"email": "workflow@example.com", "password": PASSWORD})
        self.assertEqual(response.status_code, 401)
        self.assertTrue(any(f.get("is_pending") and f["id"] == "verify_email" for f in response.json()["data"]["flows"]))

    @override_settings(DEBUG=True, AUTH_LOCAL_INBOX_ENABLED=True, EMAIL_BACKEND="accounts.email_backend.LocalInboxBackend")
    def test_local_inbox_is_session_scoped_and_not_public(self):
        self.client.get("/api/accounts/status/", HTTP_HOST="localhost")
        response = self.client.post(AUTH + "auth/signup", {"email": "local@example.com", "password": PASSWORD},
                                    content_type="application/json", HTTP_HOST="localhost", HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(len(self.client.get("/api/accounts/local-inbox/", HTTP_HOST="localhost").json()["messages"]), 1)
        other = Client()
        other.get("/api/accounts/status/", HTTP_HOST="localhost")
        self.assertEqual(other.get("/api/accounts/local-inbox/", HTTP_HOST="localhost").json()["messages"], [])
        self.assertEqual(self.client.get("/api/accounts/local-inbox/", HTTP_HOST="localhost", REMOTE_ADDR="192.0.2.4").status_code, 404)
        with override_settings(DEBUG=False):
            self.assertEqual(self.client.get("/api/accounts/local-inbox/", HTTP_HOST="localhost").status_code, 404)
