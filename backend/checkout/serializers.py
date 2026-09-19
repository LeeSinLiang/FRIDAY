from rest_framework import serializers
from .catalogue import PRODUCTS


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(self.fields):
            raise serializers.ValidationError("Unexpected properties. Use the documented request fields.")
        return super().to_internal_value(data)


class ItemSerializer(StrictSerializer):
    product_id = serializers.ChoiceField(choices=list(PRODUCTS))
    quantity = serializers.IntegerField(min_value=1, max_value=10)

    def to_internal_value(self, data):
        if not isinstance(data, dict) or type(data.get("quantity")) is not int:
            raise serializers.ValidationError("Expected an integer.")
        return super().to_internal_value(data)


class CreateCheckoutSerializer(StrictSerializer):
    items = ItemSerializer(many=True, min_length=1, max_length=10)

    def validate_items(self, value):
        if len({item["product_id"] for item in value}) != len(value):
            raise serializers.ValidationError("Combine duplicate products into one quantity.")
        return value


class ApproveCheckoutSerializer(StrictSerializer):
    snapshot_hash = serializers.RegexField(r"^[a-f0-9]{64}$")
    approved = serializers.BooleanField()
    code = serializers.RegexField(r"^[0-9]{6}$", trim_whitespace=True)

    def validate_approved(self, value):
        if self.initial_data.get("approved") is not True:
            raise serializers.ValidationError("Explicit approval is required.")
        return value


class SubmitCheckoutSerializer(StrictSerializer):
    snapshot_hash = serializers.RegexField(r"^[a-f0-9]{64}$")
