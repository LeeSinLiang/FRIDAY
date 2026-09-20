from datetime import timedelta
from unittest.mock import patch
from django.test import Client
from django.utils import timezone
from accounts.tests import AccountTestCase, PASSWORD, totp
from allauth.account.models import EmailAddress
from allauth.mfa.models import Authenticator
from .models import Checkout, CheckoutApproval


class CheckoutWorkflowTests(AccountTestCase):
    def checkout_request(self, path="", data=None, client=None):
        client = client or self.client
        return client.post("/api/checkouts/" + path, data=data or {}, content_type="application/json",
                           HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)

    def draft(self):
        user, secret = self.enrolled()
        response = self.checkout_request(data={"items": [{"product_id": "sample-sofa", "quantity": 1}]})
        self.assertEqual(response.status_code, 201, response.content)
        return user, secret, response.json()["data"]

    def approved(self):
        user, secret, checkout = self.draft()
        response = self.checkout_request(checkout["id"] + "/approve/", {
            "snapshot_hash": checkout["snapshot_hash"], "approved": True, "code": totp(secret)})
        self.assertEqual(response.status_code, 200, response.content)
        return user, secret, response.json()["data"]

    def test_checkout_rejects_anonymous_unverified_and_no_mfa(self):
        self.assertEqual(self.checkout_request().status_code, 401)
        user = self.verified()
        self.assertEqual(self.checkout_request().status_code, 403)
        EmailAddress.objects.filter(user=user).update(verified=False)
        self.assertEqual(self.checkout_request().status_code, 403)

    def test_totals_are_server_owned_and_unknown_fields_fail(self):
        self.enrolled()
        item = {"product_id": "sample-sofa", "quantity": 2}
        response = self.checkout_request(data={"items": [item]})
        self.assertEqual(response.json()["data"]["snapshot"]["amount"], 85000)
        for extra in ({"amount": 1}, {"mfaVerified": True}):
            self.assertEqual(self.checkout_request(data={"items": [item], **extra}).status_code, 400)
        for quantity in (True, 1.5, "1", 0, 11):
            self.assertEqual(self.checkout_request(data={"items": [{**item, "quantity": quantity}]}).status_code, 400)

    def test_direct_submit_without_approval_never_calls_visa(self):
        _, _, checkout = self.draft()
        with patch("checkout.services.submit_idx") as visa:
            response = self.checkout_request(checkout["id"] + "/submit/", {"snapshot_hash": checkout["snapshot_hash"]})
            self.assertEqual(response.status_code, 403)
            visa.assert_not_called()

    def test_checkout_approval_requires_consent_and_correct_snapshot(self):
        _, secret, checkout = self.draft()
        data = {"snapshot_hash": checkout["snapshot_hash"], "approved": True, "code": totp(secret)}
        for value in (False, "true", 1):
            self.assertEqual(self.checkout_request(checkout["id"] + "/approve/", {**data, "approved": value}).status_code, 400)
        self.assertEqual(self.checkout_request(checkout["id"] + "/approve/", {**data, "snapshot_hash": "a" * 64}).status_code, 409)
        self.assertEqual(self.checkout_request(checkout["id"] + "/approve/", {**data, "code": totp(secret, -120)}).status_code, 400)
        self.assertFalse(CheckoutApproval.objects.exists())

    def test_other_user_and_other_session_cannot_use_approval(self):
        user, _, checkout = self.approved()
        other = Client(enforce_csrf_checks=True)
        other.get("/api/accounts/status/")
        # Even a second authenticated session for the SAME account cannot reuse it.
        other.force_login(user, backend="allauth.account.auth_backends.AuthenticationBackend")
        self.assertEqual(self.checkout_request(checkout["id"] + "/submit/", {"snapshot_hash": checkout["snapshot_hash"]}, client=other).status_code, 403)
        from django.contrib.auth import get_user_model
        stranger = get_user_model().objects.create_user(username="stranger", email="stranger@example.com", password=PASSWORD)
        EmailAddress.objects.create(user=stranger, email=stranger.email, primary=True, verified=True)
        Authenticator.objects.create(user=stranger, type="totp", data={})
        other.force_login(stranger, backend="allauth.account.auth_backends.AuthenticationBackend")
        self.assertEqual(other.get(f'/api/checkouts/{checkout["id"]}/').status_code, 404)

    def test_expired_approval_and_modified_snapshot_rejected(self):
        _, _, checkout = self.approved()
        approval = CheckoutApproval.objects.get()
        approval.expires_at = timezone.now() - timedelta(seconds=1)
        approval.save()
        self.assertEqual(self.checkout_request(checkout["id"] + "/submit/", {"snapshot_hash": checkout["snapshot_hash"]}).status_code, 403)
        record = Checkout.objects.get()
        record.snapshot["amount"] = 1
        record.save()
        self.assertEqual(self.checkout_request(checkout["id"] + "/submit/", {"snapshot_hash": checkout["snapshot_hash"]}).status_code, 409)

    def test_submission_consumes_once_and_sends_only_synthetic_idx_fields(self):
        _, _, checkout = self.approved()
        evidence = {"http_status": 200, "message": "Synthetic unit-test receipt", "payment_authorization": "not_attempted", "vendor_order": "not_attempted"}
        with patch("checkout.services.load_credentials", return_value={}), patch("checkout.services.submit_idx", return_value=("accepted", evidence)) as visa:
            response = self.checkout_request(checkout["id"] + "/submit/", {"snapshot_hash": checkout["snapshot_hash"]})
            self.assertEqual(response.status_code, 200, response.content)
            payload = visa.call_args.args[0]
            self.assertEqual(payload["purchaseAmount"], "42500")
            self.assertEqual(payload["transID"], checkout["trans_id"])
            self.assertEqual(payload["email"], "sandbox@example.com")
            self.assertNotIn("code", payload)
            self.assertNotIn("approved", payload)
            self.assertEqual(self.checkout_request(checkout["id"] + "/submit/", {"snapshot_hash": checkout["snapshot_hash"]}).status_code, 403)
            visa.assert_called_once()
        self.assertIsNotNone(CheckoutApproval.objects.get().consumed_at)

    def test_uncertain_response_is_saved_without_retry(self):
        _, _, checkout = self.approved()
        with patch("checkout.services.load_credentials", return_value={}), patch("checkout.services.submit_idx", side_effect=RuntimeError("unexpected")) as visa:
            response = self.checkout_request(checkout["id"] + "/submit/", {"snapshot_hash": checkout["snapshot_hash"]})
            self.assertEqual(response.json()["data"]["state"], "transport_unknown")
            self.checkout_request(checkout["id"] + "/submit/", {"snapshot_hash": checkout["snapshot_hash"]})
            visa.assert_called_once()

    def test_accepted_login_code_cannot_approve_checkout(self):
        _, secret, checkout = self.draft()
        code = totp(secret)  # the SAME code, replayed: recomputing it could cross into a new window and be valid
        self.request("auth/2fa/reauthenticate", {"code": code})
        self.assertEqual(self.checkout_request(checkout["id"] + "/approve/", {
            "snapshot_hash": checkout["snapshot_hash"], "approved": True, "code": code}).status_code, 400)
