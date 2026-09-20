import uuid

from django.db import models


class SandboxAttempt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session_key = models.CharField(max_length=40)
    trans_id = models.UUIDField(unique=True)
    payload = models.JSONField()
    payload_hash = models.CharField(max_length=64)
    state = models.CharField(max_length=32, default="validated")
    evidence = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True)
