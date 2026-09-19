from datetime import timedelta
from django.core.mail.backends.base import BaseEmailBackend
from django.utils import timezone
from allauth.core import context
from .models import DevelopmentEmail
from .policy import local_inbox_allowed


class LocalInboxBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        request = context.request
        if not request or not local_inbox_allowed(request):
            raise RuntimeError("Local inbox requires an enabled local development session; configure SMTP for delivery.")
        mailbox = request.session.get("local_mailbox")
        if not mailbox:
            raise RuntimeError("Initialize the account page before sending a local test email.")
        DevelopmentEmail.objects.filter(created_at__lt=timezone.now() - timedelta(minutes=30)).delete()
        for message in email_messages:
            DevelopmentEmail.objects.create(mailbox=mailbox, subject=message.subject, body=message.body)
        return len(email_messages)
