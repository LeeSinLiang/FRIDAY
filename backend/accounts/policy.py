import ipaddress
from allauth.account.models import EmailAddress
from allauth.mfa.models import Authenticator
from django.conf import settings


def local_inbox_allowed(request):
    try:
        return (settings.DEBUG and settings.AUTH_LOCAL_INBOX_ENABLED
                and settings.EMAIL_BACKEND == "accounts.email_backend.LocalInboxBackend"
                and ipaddress.ip_address(request.META.get("REMOTE_ADDR", "")).is_loopback
                and request.get_host().split(":")[0] in ("localhost", "127.0.0.1"))
    except ValueError:
        return False


def account_status(user):
    authenticated = user.is_authenticated
    verified = authenticated and EmailAddress.objects.filter(user=user, primary=True, verified=True).exists()
    mfa = authenticated and Authenticator.objects.filter(user=user, type=Authenticator.Type.TOTP).exists()
    return {"authenticated": authenticated, "email": user.email if authenticated else None,
            "email_verified": bool(verified), "mfa_enabled": bool(mfa),
            "checkout_ready": bool(verified and mfa)}
