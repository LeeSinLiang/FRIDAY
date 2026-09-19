import os
from cryptography.fernet import Fernet
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Create the development MFA encryption key once; never replace an existing key."

    def handle(self, **options):
        path = settings.MFA_ENCRYPTION_KEY_FILE
        if not path.exists():
            if not settings.DEBUG:
                raise CommandError("Provision the MFA encryption key before deployment.")
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(Fernet.generate_key())
        from accounts.adapters import cipher
        cipher()
        self.stdout.write("MFA encryption key ready (existing keys preserved).")
