"""Deliberately small, strict subset of Visa IDX v1 for synthetic tests only."""
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone

from rest_framework import serializers

TEST_ACCOUNTS = ("4005529999000123", "4111111111111111")


def encode_json(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")


def payload_hash(payload):
    return hashlib.sha256(encode_json(payload)).hexdigest()


def sample_payload():
    return {
        "acctNumber": TEST_ACCOUNTS[0], "acquirerBIN": "438309",
        "purchaseAmount": "12550", "purchaseCurrency": "840", "purchaseExponent": "2",
        "purchaseDate": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
        "transID": str(uuid.uuid4()), "merchantID": "00002000000",
        "merchantName": "HackMIT Sandbox Store", "mcc": "5411",
        "deviceChannel": "02", "productType": "02", "transType": "01",
        "messageCategory": "01", "browserIP": "192.0.2.1",
        "email": "sandbox@example.com", "requestDCAPStatus": False,
    }


class IdxSampleSerializer(serializers.Serializer):
    acctNumber = serializers.ChoiceField(choices=TEST_ACCOUNTS)
    acquirerBIN = serializers.RegexField(r"^[0-9]{6,11}$")
    purchaseAmount = serializers.RegexField(r"^[0-9]{1,48}$")
    purchaseCurrency = serializers.ChoiceField(choices=["840"])
    purchaseExponent = serializers.ChoiceField(choices=["2"])
    purchaseDate = serializers.RegexField(r"^[0-9]{14}$")
    transID = serializers.CharField()
    merchantID = serializers.CharField(max_length=35, required=False)
    merchantName = serializers.CharField(max_length=40, required=False)
    mcc = serializers.RegexField(r"^[0-9]{4}$", required=False)
    deviceChannel = serializers.ChoiceField(choices=["02"], required=False)
    productType = serializers.ChoiceField(choices=["01", "02"], required=False)
    transType = serializers.ChoiceField(choices=["01"], required=False)
    messageCategory = serializers.ChoiceField(choices=["01", "02"], required=False)
    browserIP = serializers.ChoiceField(choices=["192.0.2.1"], required=False)
    email = serializers.ChoiceField(choices=["sandbox@example.com"], required=False)
    requestDCAPStatus = serializers.BooleanField(required=False)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"payload": "Expected a JSON object."})
        unknown = sorted(set(data) - set(self.fields))
        if unknown:
            raise serializers.ValidationError({"unknown_fields": unknown})
        # DRF normally coerces numeric/boolean values. IDX has exact JSON types.
        errors = {}
        for name, value in data.items():
            if name == "requestDCAPStatus":
                if type(value) is not bool:
                    errors[name] = "Expected a JSON boolean."
            elif not isinstance(value, str):
                errors[name] = "Expected a JSON string."
        if errors:
            raise serializers.ValidationError(errors)
        return super().to_internal_value(data)

    def validate_transID(self, value):
        try:
            parsed = uuid.UUID(value)
        except (ValueError, AttributeError):
            raise serializers.ValidationError("Expected a UUID.")
        if str(parsed) != value.lower():
            raise serializers.ValidationError("Use a hyphenated UUID.")
        return str(parsed)

    def validate_purchaseDate(self, value):
        try:
            date = datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        except ValueError:
            raise serializers.ValidationError("Expected a real UTC YYYYMMDDHHMMSS timestamp.")
        if abs((datetime.now(timezone.utc) - date).total_seconds()) > 300:
            raise serializers.ValidationError("Generate a fresh sample; the timestamp is over five minutes old.")
        return value

    def validate_purchaseAmount(self, value):
        if not 1 <= int(value) <= 1000000:
            raise serializers.ValidationError("This tester accepts 1–1000000 minor units.")
        return value

    def validate(self, attrs):
        if not attrs.get("browserIP"):
            raise serializers.ValidationError({"browserIP": "Include the synthetic browser IP for this browser fixture."})
        return attrs


def safe_payload(payload):
    return {**payload, "acctNumber": "••••" + payload["acctNumber"][-4:]}
