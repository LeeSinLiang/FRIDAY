import uuid
from django.db import models
from django.conf import settings


class RecoveryAcknowledgement(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    authenticator = models.ForeignKey('mfa.Authenticator', on_delete=models.CASCADE)
    acknowledged_at = models.DateTimeField(auto_now_add=True)


class DevelopmentEmail(models.Model):
    """Temporary local test messages, isolated by an unguessable browser mailbox."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    mailbox = models.UUIDField(db_index=True)
    subject = models.CharField(max_length=255)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
