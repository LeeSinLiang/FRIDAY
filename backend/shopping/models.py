import secrets
import uuid
from django.conf import settings
from django.db import models


def scene_key():
    return secrets.token_hex(20)


class ShoppingSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token_hash = models.CharField(max_length=64, unique=True)
    scene_key = models.CharField(max_length=40, unique=True, default=scene_key)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.CASCADE)
    revision = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)


class CartItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shopping = models.ForeignKey(ShoppingSession, on_delete=models.CASCADE, related_name='items')
    room_id = models.CharField(max_length=128)
    instance_id = models.CharField(max_length=128)
    product_id = models.CharField(max_length=128)
    selected = models.BooleanField(default=True)
    present = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['shopping', 'room_id', 'instance_id'], name='unique_cart_instance')]


class ShoppingOperation(models.Model):
    shopping = models.ForeignKey(ShoppingSession, on_delete=models.CASCADE)
    operation_id = models.CharField(max_length=128)
    digest = models.CharField(max_length=64)
    result = models.JSONField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['shopping', 'operation_id'], name='unique_shopping_operation')]
