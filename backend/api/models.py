import uuid
from django.db import models


class SceneLayout(models.Model):
    session_key = models.CharField(max_length=40, unique=True)
    instances = models.JSONField(default=list)
    revision = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)


class SceneCommandReceipt(models.Model):
    scene = models.ForeignKey(SceneLayout, on_delete=models.CASCADE)
    command_id = models.CharField(max_length=128)
    payload_hash = models.CharField(max_length=64)
    response = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['scene', 'command_id'], name='unique_scene_command')]


class SceneCapture(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scene = models.ForeignKey(SceneLayout, on_delete=models.CASCADE)
    request_id = models.CharField(max_length=128)
    payload_hash = models.CharField(max_length=64)
    snapshot = models.JSONField()
    revision = models.PositiveIntegerField()
    view = models.CharField(max_length=16)
    camera = models.JSONField(null=True)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    status = models.CharField(max_length=16, default='pending')
    lease_token = models.UUIDField(null=True)
    lease_until = models.DateTimeField(null=True)
    expires_at = models.DateTimeField()
    image = models.BinaryField(null=True)
    error = models.JSONField(null=True)
    model_warnings = models.JSONField(default=list)
    completed_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['scene', 'request_id'], name='unique_scene_capture_request')]
