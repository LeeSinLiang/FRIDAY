"""Why the account tests run with MFA_TOTP_TOLERANCE=1, shown deterministically.

The test helper totp() reads the wall clock; the server reads it again a few milliseconds later. When a
30-second TOTP window ends between those two readings, the helper's code is one step old. With allauth's
default tolerance of 0 the server refuses it ("Incorrect code."), which is what turned a docs-only branch
red on 2026-09-20. This file stops the clock on either side of a boundary instead of waiting for it.
"""
import time
from unittest import mock

from django.test import override_settings

from accounts.tests import AUTH, PASSWORD, AccountTestCase, totp

SERVER_CLOCK = "allauth.mfa.totp.internal.auth.time"  # the name `time` inside allauth's TOTP module only


class TotpWindowBoundaryTests(AccountTestCase):
    def enrol_across_a_boundary(self):
        """Compute the code 50 ms before a window ends, have the server check it 50 ms after."""
        self.verified()
        self.assertEqual(self.request("auth/reauthenticate", {"password": PASSWORD}).status_code, 200)
        secret = self.client.get(AUTH + "account/authenticators/totp").json()["meta"]["secret"]
        boundary = (int(time.time()) // 30 + 1) * 30
        with mock.patch("accounts.tests.time") as test_clock:
            test_clock.time.return_value = boundary - 0.05
            code = totp(secret)
        with mock.patch(SERVER_CLOCK) as server_clock:
            server_clock.time.return_value = boundary + 0.05
            return self.request("account/authenticators/totp", {"code": code})

    def test_the_suite_setting_accepts_a_code_from_the_window_that_just_ended(self):
        response = self.enrol_across_a_boundary()
        self.assertEqual(response.status_code, 200, response.content)

    @override_settings(MFA_TOTP_TOLERANCE=0)
    def test_without_it_the_same_code_is_refused_which_is_the_flake(self):
        response = self.enrol_across_a_boundary()
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["errors"][0]["code"], "incorrect_code")

    def test_the_tolerance_is_one_step_not_a_loophole(self):
        # A code two minutes old is still refused: the tests that assert expiry keep their meaning.
        self.verified()
        self.assertEqual(self.request("auth/reauthenticate", {"password": PASSWORD}).status_code, 200)
        secret = self.client.get(AUTH + "account/authenticators/totp").json()["meta"]["secret"]
        self.assertEqual(self.request("account/authenticators/totp", {"code": totp(secret, -120)}).status_code, 400)
