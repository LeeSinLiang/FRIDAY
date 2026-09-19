import json
import uuid
from datetime import timedelta
from django.http import JsonResponse, HttpResponse, Http404
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST
from django.utils import timezone
from allauth.mfa.adapter import get_adapter
from allauth.account.internal.flows.email_verification_by_code import EmailVerificationProcess
from allauth.headless.account.inputs import VerifyEmailInput
from .models import DevelopmentEmail
from .policy import account_status, local_inbox_allowed


@require_GET
@ensure_csrf_cookie
def status(request):
    inbox = local_inbox_allowed(request)
    if inbox and "local_mailbox" not in request.session:
        request.session["local_mailbox"] = str(uuid.uuid4())
    return JsonResponse({**account_status(request.user), "local_inbox": inbox})


@require_GET
def inbox(request):
    if not local_inbox_allowed(request) or not request.session.get("local_mailbox"):
        raise Http404()
    messages = DevelopmentEmail.objects.filter(
        mailbox=request.session["local_mailbox"], created_at__gte=timezone.now() - timedelta(minutes=30)
    ).order_by("-created_at")[:10]
    return JsonResponse({"messages": [{"id": str(m.id), "subject": m.subject, "body": m.body} for m in messages]})


@require_POST
def confirm_email(request):
    """Confirm fresh inbox access without changing an already verified account."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in before confirming your email."}, status=401)
    process = EmailVerificationProcess.resume(request)
    if not process:
        return JsonResponse({"error": "Send a new confirmation email."}, status=409)
    address = process.email_address
    if (address.user_id != request.user.pk or not address.primary or not address.verified
            or address.email != request.user.email):
        return JsonResponse({"error": "This confirmation does not belong to your verified primary email."}, status=403)
    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict):
            raise ValueError
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"error": "Enter your email confirmation code."}, status=400)
    form = VerifyEmailInput(payload, process=process)
    if not form.is_valid():
        process.record_invalid_attempt()
        return JsonResponse({"errors": [{"message": str(message)} for messages in form.errors.values() for message in messages]}, status=400)
    # allauth's normal finish() returns None for an already verified address,
    # which its signup view treats as HTTP 500. Consume only this fresh challenge.
    process.abort()
    return JsonResponse({"confirmed": True})


@require_GET
def totp_qr(request):
    # Render only the setup secret already created by the allauth enrollment API.
    if not request.user.is_authenticated or not account_status(request.user)["email_verified"]:
        return JsonResponse({"error": "Verified account required."}, status=403)
    secret = request.session.get("mfa.totp.secret")
    if not secret:
        return JsonResponse({"error": "Start authenticator setup first."}, status=409)
    adapter = get_adapter()
    return HttpResponse(adapter.build_totp_svg(adapter.build_totp_url(request.user, secret)), content_type="image/svg+xml")
