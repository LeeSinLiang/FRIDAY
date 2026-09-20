"""One fixed IDX sandbox endpoint. No payment or order API exists here."""
import hashlib
import hmac
import json
import re
import time
from pathlib import Path
from urllib.parse import urlencode

import httpx
from cryptography import x509
from cryptography.hazmat.primitives import serialization
from django.conf import settings
from jwcrypto import jwk, jwe

from .schema import encode_json

ENDPOINT = "https://sandbox.api.visa.com/vidx/v1/requests"
# Visa's generic X-Pay rule omits the first URL context segment (vidx).
SIGNING_PATH = "v1/requests"
ALGORITHMS = ["RSA-OAEP-256", "A128GCM", "A256GCM"]


class ConfigurationError(Exception):
    pass


def load_credentials():
    try:
        inline = bool(settings.VISA_CREDENTIALS_JSON)
        if inline:
            config = json.loads(settings.VISA_CREDENTIALS_JSON)
        else:
            path = Path(settings.VISA_SANDBOX_CREDENTIALS_FILE)
            if not settings.VISA_SANDBOX_CREDENTIALS_FILE or path.stat().st_mode & 0o077:
                raise ValueError("Use a private credential file with mode 0600.")
            config = json.loads(path.read_text())
        for key in ("api_key", "shared_secret", "mle_key_id", "server_certificate", "client_private_key"):
            if not isinstance(config.get(key), str) or not config[key].strip():
                raise ValueError("Missing credential setting.")
        certificate = x509.load_pem_x509_certificate(config["server_certificate"].encode() if inline else Path(config["server_certificate"]).read_bytes())
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        if not certificate.not_valid_before_utc <= now <= certificate.not_valid_after_utc:
            raise ValueError("Server certificate is outside its validity period.")
        config["server_key"] = jwk.JWK.from_pem(certificate.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
        if inline:
            private_bytes = config["client_private_key"].encode()
        else:
            private_path = Path(config["client_private_key"])
            if private_path.stat().st_mode & 0o077:
                raise ValueError("Use a private key file with mode 0600.")
            private_bytes = private_path.read_bytes()
        config["client_key"] = jwk.JWK.from_pem(private_bytes)
        return config
    except Exception as exc:
        # Never include parser exceptions, credential values, or private paths in UI/logs.
        raise ConfigurationError("Sandbox credentials are missing, unreadable, invalid, or not private.") from None


def readiness():
    try:
        load_credentials()
        return {"ready": True, "message": "X-Pay and MLE configuration loaded."}
    except ConfigurationError as exc:
        return {"ready": False, "message": str(exc)}


def make_xpay(secret, resource_path, query_string, body, timestamp=None):
    timestamp = str(int(time.time()) if timestamp is None else timestamp)
    message = timestamp.encode() + resource_path.encode() + query_string.encode() + body
    digest = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return f"xv2:{timestamp}:{digest}"


def encrypt_payload(payload, server_key, key_id):
    token = jwe.JWE(encode_json(payload), recipient=server_key, protected={
        "alg": "RSA-OAEP-256", "enc": "A128GCM", "kid": key_id,
        "iat": int(time.time() * 1000),
    })
    return encode_json({"encData": token.serialize(compact=True)})


def decrypt_response(data, client_key):
    token = jwe.JWE(algs=ALGORITHMS)
    token.deserialize(data["encData"], key=client_key)
    value = json.loads(token.payload)
    if not isinstance(value, dict):
        raise ValueError("Expected a response object.")
    return value


def safe_text(value, config):
    text = str(value)[:1024]
    for name in ("api_key", "shared_secret"):
        text = text.replace(config[name], "[redacted]")
    return re.sub(r"(?<![0-9])[0-9]{13,19}(?![0-9])", "[redacted-account]", text)


def submit_idx(payload, config):
    query = urlencode({"apikey": config["api_key"]})
    wire_body = encrypt_payload(payload, config["server_key"], config["mle_key_id"])
    headers = {
        "Content-Type": "application/json", "Accept": "application/json",
        "keyId": config["mle_key_id"],
        "x-pay-token": make_xpay(config["shared_secret"], SIGNING_PATH, query, wire_body),
        "ex-correlation-id": payload["transID"],
    }
    evidence = {
        "endpoint": ENDPOINT, "signing_resource_path": SIGNING_PATH,
        "request_fields": sorted(payload),
        "encrypted_request_sha256": hashlib.sha256(wire_body).hexdigest(),
        "payment_authorization": "not_attempted", "vendor_order": "not_attempted",
    }
    started = time.monotonic()
    try:
        # Disable environment proxies and redirects; credentials only go to this host.
        with httpx.Client(timeout=25, follow_redirects=False, trust_env=False) as client:
            response = client.post(ENDPOINT + "?" + query, content=wire_body, headers=headers)
    except httpx.HTTPError:
        return "transport_unknown", {**evidence, "message": "No confirmed response. Visa receipt is unknown; no automatic retry.",
                                     "elapsed_ms": round((time.monotonic() - started) * 1000)}
    evidence.update({"http_status": response.status_code,
                     "elapsed_ms": round((time.monotonic() - started) * 1000),
                     "response_headers": {name: safe_text(response.headers[name], config) for name in
                        ("x-correlation-id", "ex-correlation-id", "x-global-transaction-id", "x-app-status")
                        if name in response.headers}})
    try:
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError()
        encrypted = isinstance(data.get("encData"), str)
        if encrypted:
            data = decrypt_response(data, config["client_key"])
        evidence["response_encrypted"] = encrypted
        if response.status_code != 200:
            status = data.get("responseStatus", {})
            if not isinstance(status, dict):
                status = {}
            evidence["error"] = {
                "reason": safe_text(data.get("reason", status.get("code", "upstream_rejection")), config),
                "field_locations": [safe_text(item.get("location", ""), config)
                                    for item in data.get("details", []) if isinstance(item, dict)],
            }
            return "rejected", evidence
        match_key = data.get("idxMatchKey")
        if not isinstance(match_key, str) or not 10 <= len(match_key) <= 50:
            raise ValueError()
        if not isinstance(data.get("transID"), str):
            raise ValueError()
        if "dcapIndicator" in data and (type(data["dcapIndicator"]) is not int or data["dcapIndicator"] not in (1, 2)):
            raise ValueError()
        warnings = data.get("warningMessages", [])
        if not isinstance(warnings, list) or not all(isinstance(x, str) for x in warnings):
            raise ValueError()
        evidence["response"] = {"transID": safe_text(data["transID"], config), "idxMatchKey": match_key,
                                "warningMessages": [safe_text(x, config) for x in warnings]}
        if "dcapIndicator" in data:
            evidence["response"]["dcapIndicator"] = data["dcapIndicator"]
        evidence["transaction_id_matches"] = data["transID"] == payload["transID"]
        if not encrypted:
            evidence["message"] = "Visa returned a Match Key, but encrypted-response verification did not pass."
            return "unverified_response", evidence
        if not evidence["transaction_id_matches"]:
            evidence["message"] = "Visa returned a Match Key with a different transaction ID; correlation is unverified."
            return "unverified_response", evidence
        evidence["message"] = "Visa IDX accepted the sample and returned a matching transaction ID and Match Key."
        return "accepted", evidence
    except Exception:
        evidence["message"] = "Visa replied, but response decryption or schema validation failed."
        return "invalid_response", evidence
