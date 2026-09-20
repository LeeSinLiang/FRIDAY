import uuid
from django.db import models


class DevelopmentEmail(models.Model):
    """Temporary local test messages, isolated by an unguessable browser mailbox."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    mailbox = models.UUIDField(db_index=True)
    subject = models.CharField(max_length=255)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
