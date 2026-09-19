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
