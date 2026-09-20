from cryptography.fernet import Fernet
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from allauth.mfa.adapter import DefaultMFAAdapter


def cipher():
    if settings.MFA_ENCRYPTION_KEY:
        try:
            return Fernet(settings.MFA_ENCRYPTION_KEY.encode())
        except ValueError:
            raise ImproperlyConfigured("Invalid MFA encryption key configuration.") from None
    path = settings.MFA_ENCRYPTION_KEY_FILE
    try:
        if path.stat().st_mode & 0o077:
            raise ValueError()
        return Fernet(path.read_bytes().strip())
    except (OSError, ValueError):
        raise ImproperlyConfigured("MFA encryption key unavailable. Run setup or configure a private key file.") from None


class EncryptedMFAAdapter(DefaultMFAAdapter):
    def encrypt(self, text):
        return cipher().encrypt(text.encode()).decode()

    def decrypt(self, encrypted_text):
        return cipher().decrypt(encrypted_text.encode()).decode()
