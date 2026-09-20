import json
from datetime import timedelta
from unittest.mock import MagicMock, patch

import httpx
from django.test import Client, TestCase, SimpleTestCase, override_settings
from django.utils import timezone
from jwcrypto import jwk, jwe

from .client import decrypt_response, encrypt_payload, make_xpay, submit_idx
from .models import SandboxAttempt
from .schema import IdxSampleSerializer, encode_json, sample_payload


class SchemaTests(SimpleTestCase):
    def test_reference_fixture_and_browser_physical_goods_tags(self):
        fixture = sample_payload()
        serializer = IdxSampleSerializer(data=fixture)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(fixture["deviceChannel"], "02")
        self.assertEqual(fixture["productType"], "02")

    def test_rejects_missing_fields_wrong_types_unknown_tags_and_real_data(self):
        for field in ("acctNumber", "acquirerBIN", "purchaseAmount", "purchaseCurrency", "purchaseExponent", "purchaseDate", "transID"):
            with self.subTest(missing=field):
                fixture = sample_payload(); del fixture[field]
                self.assertFalse(IdxSampleSerializer(data=fixture).is_valid())
        for change in ({"purchaseAmount": 12550}, {"requestDCAPStatus": "true"},
                       {"mfaVerified": True}, {"email": "person@real-domain.net"},
                       {"acctNumber": "4242424242424242"}, {"purchaseCurrency": "USD"},
                       {"purchaseDate": "20260999999999"}):
            with self.subTest(change=change):
                self.assertFalse(IdxSampleSerializer(data={**sample_payload(), **change}).is_valid())


class CryptoAndTransportTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.server = jwk.JWK.generate(kty="RSA", size=2048)
        cls.client_key = jwk.JWK.generate(kty="RSA", size=2048)
        cls.config = {"api_key": "test-key", "shared_secret": "test-secret", "mle_key_id": "test-id",
                      "server_key": jwk.JWK.from_json(cls.server.export_public()), "client_key": cls.client_key}

    def test_xpay_known_vector_and_body_binding(self):
        body = b'{"encData":"fixture"}'
        expected = "xv2:1700000000:d9ec6a5147ae22f41354c305c699c3ec9188e6bee160e84ff620faad653fe12f"
        self.assertEqual(make_xpay("test-secret", "v1/requests", "apikey=test-key", body, 1700000000), expected)
        self.assertNotEqual(make_xpay("test-secret", "v1/requests", "apikey=test-key", body+b" ", 1700000000), expected)

    def response(self, payload, *, trans_id=None, status=200, encrypted=True):
        body = {"transID": trans_id or payload["transID"], "idxMatchKey": "IQYgAxdYYgAAAGqyhAJocAAAAAA=", "dcapIndicator": 1}
        if encrypted:
            token = jwe.JWE(encode_json(body), recipient=jwk.JWK.from_json(self.client_key.export_public()),
                            protected={"alg": "RSA-OAEP-256", "enc": "A128GCM"})
            body = {"encData": token.serialize(compact=True)}
        return httpx.Response(status, json=body)

    def test_full_crypto_wire_request_and_correlated_response(self):
        payload = sample_payload()
        with patch("visa.client.httpx.Client") as factory:
            post = factory.return_value.__enter__.return_value.post
            post.return_value = self.response(payload)
            state, evidence = submit_idx(payload, self.config)
            self.assertEqual(state, "accepted")
            self.assertTrue(evidence["transaction_id_matches"])
            factory.assert_called_once_with(timeout=25, follow_redirects=False, trust_env=False)
            args, kwargs = post.call_args
            self.assertEqual(args[0], "https://sandbox.api.visa.com/vidx/v1/requests?apikey=test-key")
            self.assertEqual(decrypt_response(json.loads(kwargs["content"]), self.server), payload)
            stamp = kwargs["headers"]["x-pay-token"].split(":")[1]
            self.assertEqual(kwargs["headers"]["x-pay-token"], make_xpay("test-secret", "v1/requests", "apikey=test-key", kwargs["content"], stamp))

    def test_uncorrelated_or_unencrypted_success_does_not_pass(self):
        payload = sample_payload()
        for response in (self.response(payload, trans_id="different"), self.response(payload, encrypted=False)):
            with self.subTest(), patch("visa.client.httpx.Client") as factory:
                factory.return_value.__enter__.return_value.post.return_value = response
                self.assertEqual(submit_idx(payload, self.config)[0], "unverified_response")

    def test_upstream_rejection_and_timeout_are_not_success(self):
        with patch("visa.client.httpx.Client") as factory:
            post = factory.return_value.__enter__.return_value.post
            post.return_value = httpx.Response(401, json={"responseStatus": {"code": "9159"}})
            self.assertEqual(submit_idx(sample_payload(), self.config)[0], "rejected")
            post.side_effect = httpx.ReadTimeout("test")
            self.assertEqual(submit_idx(sample_payload(), self.config)[0], "transport_unknown")

    def test_ciphertext_tampering_is_rejected(self):
        wire = json.loads(encrypt_payload(sample_payload(), self.config["server_key"], "test-id"))
        parts = wire["encData"].split(".")
        parts[3] = ("A" if parts[3][0] != "A" else "B") + parts[3][1:]
        with self.assertRaises(Exception):
            decrypt_response({"encData": ".".join(parts)}, self.server)


@override_settings(DEBUG=True, VISA_SANDBOX_TESTER_ENABLED=True, ALLOWED_HOSTS=["localhost"])
class GuardTests(TestCase):
    def setUp(self):
        self.client = Client(HTTP_HOST="localhost", REMOTE_ADDR="127.0.0.1")
        self.base = "/api/visa/sandbox-test/"

    def validate(self):
        result = self.client.post(self.base+"validate/", {"payload": sample_payload()}, content_type="application/json")
        self.assertEqual(result.status_code, 201, result.content)
        return result.json()

    def approval(self, value):
        return {"attempt_id": value["attempt_id"], "payload_hash": value["payload_hash"], "approved": True}

    def test_hidden_outside_explicit_local_debug_mode(self):
        with override_settings(DEBUG=False):
            self.assertEqual(self.client.get(self.base).status_code, 404)
        with override_settings(VISA_SANDBOX_TESTER_ENABLED=False):
            self.assertEqual(self.client.get(self.base).status_code, 404)
        self.assertEqual(self.client.get(self.base, REMOTE_ADDR="203.0.113.1").status_code, 404)

    def test_csrf_is_required(self):
        browser = Client(enforce_csrf_checks=True, HTTP_HOST="localhost", REMOTE_ADDR="127.0.0.1")
        self.assertEqual(browser.post(self.base+"validate/", {"payload": sample_payload()}, content_type="application/json").status_code, 403)

    @patch("visa.views.submit_idx")
    @patch("visa.views.load_credentials", return_value={})
    def test_explicit_approval_hash_and_single_submission(self, config, send):
        value = self.validate(); approval = self.approval(value)
        for invalid, status in [({**approval, "approved": False}, 403), ({**approval, "payload_hash": "wrong"}, 409)]:
            self.assertEqual(self.client.post(self.base+"submit/", invalid, content_type="application/json").status_code, status)
        send.assert_not_called()
        send.return_value = ("accepted", {"http_status": 200})
        self.assertEqual(self.client.post(self.base+"submit/", approval, content_type="application/json").json()["state"], "accepted")
        self.assertEqual(self.client.post(self.base+"submit/", approval, content_type="application/json").status_code, 409)
        send.assert_called_once()

    @patch("visa.views.submit_idx")
    def test_expired_or_cross_session_approval_is_rejected(self, send):
        value = self.validate(); approval = self.approval(value)
        other = Client(HTTP_HOST="localhost", REMOTE_ADDR="127.0.0.1")
        self.assertEqual(other.post(self.base+"submit/", approval, content_type="application/json").status_code, 404)
        self.assertEqual(other.get(self.base+"attempts/"+value["attempt_id"]+"/").status_code, 404)
        SandboxAttempt.objects.filter(id=value["attempt_id"]).update(created_at=timezone.now()-timedelta(minutes=6))
        self.assertEqual(self.client.post(self.base+"submit/", approval, content_type="application/json").status_code, 409)
        send.assert_not_called()

    def test_bad_uuid_does_not_raise_debug_exception(self):
        self.assertEqual(self.client.post(self.base+"submit/", {"attempt_id":"bad", "payload_hash":"x", "approved":True}, content_type="application/json").status_code, 404)
