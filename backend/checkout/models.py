import uuid
from django.conf import settings
from django.db import models


class Checkout(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    snapshot = models.JSONField()
    snapshot_hash = models.CharField(max_length=64)
    state = models.CharField(max_length=32, default="draft")
    trans_id = models.UUIDField(default=uuid.uuid4, unique=True)
    evidence = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    finished_at = models.DateTimeField(null=True)


class CheckoutApproval(models.Model):
    checkout = models.OneToOneField(Checkout, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    session_key = models.CharField(max_length=40)
    snapshot_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True)
