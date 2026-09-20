from datetime import timedelta
from allauth.mfa.base.forms import ReauthenticateForm
from django.db import transaction
from django.utils import timezone
from visa.client import load_credentials, submit_idx
from visa.schema import IdxSampleSerializer, payload_hash, sample_payload
from .models import Checkout, CheckoutApproval


class CheckoutError(Exception):
    def __init__(self, message, status=409):
        self.status = status
        super().__init__(message)


def validate_snapshot(checkout, digest):
    if checkout.shopping_id and checkout.shopping.revision != checkout.cart_revision:
        raise CheckoutError("Your cart changed. Review and approve a new checkout.")
    if checkout.snapshot_hash != digest or payload_hash(checkout.snapshot) != digest:
        raise CheckoutError("Checkout details changed. Create and approve a new checkout.")
    if checkout.expires_at <= timezone.now():
        raise CheckoutError("Checkout expired. Create a new checkout.")


def approve(request, checkout, data):
    validate_snapshot(checkout, data["snapshot_hash"])
    if checkout.state != "draft":
        raise CheckoutError("This checkout has already been approved or submitted.")
    # The form verifies and consumes the code through allauth, including its rate limits.
    form = ReauthenticateForm({"code": data["code"]}, user=request.user)
    if not form.is_valid():
        raise CheckoutError(" ".join(error for errors in form.errors.values() for error in errors), 400)
    form.save()
    with transaction.atomic():
        lock_cart_snapshot(checkout, data["snapshot_hash"])
        claimed = Checkout.objects.filter(pk=checkout.pk, state="draft", snapshot_hash=data["snapshot_hash"],
                                           expires_at__gt=timezone.now()).update(state="approved")
        if not claimed:
            raise CheckoutError("Checkout state changed. Refresh before continuing.")
        CheckoutApproval.objects.create(checkout=checkout, user=request.user, session_key=request.session.session_key,
            snapshot_hash=checkout.snapshot_hash, expires_at=min(checkout.expires_at, timezone.now() + timedelta(minutes=5)))
    checkout.refresh_from_db()


def submit(request, checkout, digest):
    validate_snapshot(checkout, digest)
    approval = CheckoutApproval.objects.filter(checkout=checkout, user=request.user,
        session_key=request.session.session_key, snapshot_hash=digest, expires_at__gt=timezone.now(), consumed_at__isnull=True).first()
    if checkout.state != "approved" or not approval:
        raise CheckoutError("An unused MFA approval from this session is required.", 403)
    config = load_credentials()
    payload = sample_payload()
    payload.update(purchaseAmount=str(checkout.snapshot["amount"]), transID=str(checkout.trans_id),
                   merchantName=checkout.snapshot["vendor"]["name"])
    serializer = IdxSampleSerializer(data=payload)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        lock_cart_snapshot(checkout, digest)
        claimed = Checkout.objects.filter(pk=checkout.pk, state="approved", snapshot_hash=digest,
                                          expires_at__gt=timezone.now()).update(state="submitting")
        if not claimed:
            raise CheckoutError("A submission already started. No second request was sent.")
        consumed = CheckoutApproval.objects.filter(pk=approval.pk, consumed_at__isnull=True,
            expires_at__gt=timezone.now()).update(consumed_at=timezone.now())
        if not consumed:
            raise CheckoutError("Approval expired or was already consumed.")
    # Never hold a database transaction open during network I/O. Never automatically retry.
    try:
        state, evidence = submit_idx(dict(serializer.validated_data), config)
    except Exception:
        state, evidence = "transport_unknown", {"message": "No verified response. Do not automatically retry.",
            "payment_authorization": "not_attempted", "vendor_order": "not_attempted"}
    checkout.state, checkout.evidence, checkout.finished_at = state, evidence, timezone.now()
    checkout.save(update_fields=["state", "evidence", "finished_at"])


def lock_cart_snapshot(checkout, digest):
    # Same lock order as cart mutation: shopping identity, then checkout row.
    if checkout.shopping_id:
        from shopping.models import ShoppingSession
        checkout.shopping = ShoppingSession.objects.select_for_update().get(pk=checkout.shopping_id)
    validate_snapshot(checkout, digest)
