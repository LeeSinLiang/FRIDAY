import json
from datetime import timedelta
from functools import wraps
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST
from rest_framework.exceptions import ValidationError
from accounts.policy import account_status
from visa.client import ConfigurationError, readiness
from visa.schema import payload_hash
from . import catalogue, services
from .models import Checkout
from .serializers import CreateCheckoutSerializer, ApproveCheckoutSerializer, SubmitCheckoutSerializer


def account_required(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        state = account_status(request.user)
        if not state["authenticated"]:
            return JsonResponse({"errors": [{"message": "Sign in first."}]}, status=401)
        if not state["checkout_ready"]:
            return JsonResponse({"errors": [{"message": "Verify your email and enroll an authenticator first."}]}, status=403)
        try:
            return view(request, *args, **kwargs)
        except (ValueError, UnicodeDecodeError):
            return JsonResponse({"errors": [{"message": "Invalid request body."}]}, status=400)
        except ValidationError as exc:
            return JsonResponse({"errors": [{"message": str(exc.detail)}]}, status=400)
        except services.CheckoutError as exc:
            return JsonResponse({"errors": [{"message": str(exc)}]}, status=exc.status)
        except ConfigurationError as exc:
            return JsonResponse({"errors": [{"message": str(exc)}]}, status=503)
    return wrapped


def parse(request, cls):
    if len(request.body) > 16384:
        raise ValueError()
    serializer = cls(data=json.loads(request.body))
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def public(checkout):
    return {"id": str(checkout.id), "snapshot": checkout.snapshot, "snapshot_hash": checkout.snapshot_hash,
            "state": checkout.state, "expires_at": checkout.expires_at.isoformat(), "trans_id": str(checkout.trans_id),
            "evidence": checkout.evidence}


@account_required
@require_GET
def catalogue_view(request):
    return JsonResponse({"data": {"products": [{"id": key, **value} for key, value in catalogue.PRODUCTS.items()],
        "vendor": catalogue.VENDOR, "currency": "USD", "sandbox": True, "visa": readiness()}})


@account_required
@require_POST
def create(request):
    data = parse(request, CreateCheckoutSerializer)
    snapshot = catalogue.snapshot(data["items"])
    if snapshot["amount"] > 1000000:
        raise services.CheckoutError("Sample total exceeds the sandbox limit.", 400)
    checkout = Checkout.objects.create(user=request.user, snapshot=snapshot, snapshot_hash=payload_hash(snapshot),
                                       expires_at=timezone.now() + timedelta(minutes=15))
    return JsonResponse({"data": public(checkout)}, status=201)


@account_required
@require_GET
def detail(request, checkout_id):
    return JsonResponse({"data": public(get_object_or_404(Checkout, id=checkout_id, user=request.user))})


@account_required
@require_POST
def approve(request, checkout_id):
    checkout = get_object_or_404(Checkout, id=checkout_id, user=request.user)
    services.approve(request, checkout, parse(request, ApproveCheckoutSerializer))
    return JsonResponse({"data": public(checkout)})


@account_required
@require_POST
def submit(request, checkout_id):
    checkout = get_object_or_404(Checkout, id=checkout_id, user=request.user)
    services.submit(request, checkout, parse(request, SubmitCheckoutSerializer)["snapshot_hash"])
    return JsonResponse({"data": public(checkout)})
