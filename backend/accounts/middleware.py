import time
from allauth.account.authentication import get_authentication_records
from allauth.mfa.models import Authenticator
from django.http import JsonResponse


class AccountSecurityMiddleware:
    """Require recent MFA before replacing recovery codes or removing MFA."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = None
        sensitive = (
            request.path == "/_allauth/browser/v1/account/authenticators/totp" and request.method == "DELETE"
        ) or (
            request.path == "/_allauth/browser/v1/account/authenticators/recovery-codes" and request.method == "POST"
        )
        if sensitive and request.user.is_authenticated and Authenticator.objects.filter(user=request.user).exists():
            recent = any(r.get("method") == "mfa" and time.time() - r.get("at", 0) < 300
                         for r in get_authentication_records(request))
            if not recent:
                response = JsonResponse({"status": 403, "errors": [{"message": "Confirm a fresh authenticator or recovery code first."}]}, status=403)
        if response is None:
            response = self.get_response(request)
        if request.path.startswith(("/_allauth/", "/api/accounts/", "/api/checkouts/")):
            response["Cache-Control"] = "no-store"
            response["Referrer-Policy"] = "no-referrer"
        return response
