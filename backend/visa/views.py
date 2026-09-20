import hashlib
import json
from datetime import timedelta
from functools import wraps
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.http import Http404, JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST
from django.views.decorators.debug import sensitive_variables, sensitive_post_parameters

from .client import ConfigurationError, load_credentials, readiness, submit_idx
from .models import SandboxAttempt
from .schema import IdxSampleSerializer, payload_hash, safe_payload, sample_payload


def local_tester(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not settings.DEBUG or not settings.VISA_SANDBOX_TESTER_ENABLED:
            raise Http404()
        if request.META.get("REMOTE_ADDR") not in {"127.0.0.1", "::1"}:
            raise Http404()
        if request.get_host().split(":")[0] not in {"127.0.0.1", "localhost"}:
            raise Http404()
        response = view(request, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        response["Referrer-Policy"] = "no-referrer"
        response["X-Content-Type-Options"] = "nosniff"
        return response
    return wrapped


def read_json(request):
    if len(request.body) > 16384:
        raise ValueError("Request too large.")
    data = json.loads(request.body)
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object.")
    return data


def public_attempt(attempt):
    return {"attempt_id": str(attempt.id), "state": attempt.state,
            "payload_hash": attempt.payload_hash, "payload": safe_payload(attempt.payload),
            "created_at": attempt.created_at.isoformat(), "evidence": attempt.evidence}


def source_hash():
    root = Path(__file__).parent
    digest = hashlib.sha256()
    for path in sorted([*root.glob("*.py"), *root.glob("templates/visa/*.html")]):
        digest.update(str(path.relative_to(root)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


@local_tester
@require_GET
@ensure_csrf_cookie
def test_page(request):
    return render(request, "visa/sandbox_test.html")


@local_tester
@require_GET
def bootstrap(request):
    if not request.session.session_key:
        request.session.create()
    return JsonResponse({"configuration": readiness(), "sample": sample_payload(),
                         "source_sha256": source_hash(), "source_path": str(Path(__file__).parent.resolve()),
                         "scope": "IDX data exchange only; app email/MFA and payment/order execution are not implemented here."})


@local_tester
@require_POST
def validate(request):
    try:
        data = read_json(request)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON object."}, status=400)
    if set(data) != {"payload"}:
        return JsonResponse({"error": "Expected only the payload property."}, status=400)
    serializer = IdxSampleSerializer(data=data["payload"])
    if not serializer.is_valid():
        return JsonResponse({"errors": serializer.errors}, status=400)
    payload = dict(serializer.validated_data)
    if not request.session.session_key:
        request.session.create()
    try:
        attempt = SandboxAttempt.objects.create(session_key=request.session.session_key,
            trans_id=payload["transID"], payload=payload, payload_hash=payload_hash(payload))
    except IntegrityError:
        return JsonResponse({"error": "This transaction ID was already validated. Load a fresh sample."}, status=409)
    return JsonResponse(public_attempt(attempt), status=201)


@local_tester
@require_POST
@sensitive_variables()
@sensitive_post_parameters()
def submit(request):
    try:
        data = read_json(request)
        if set(data) != {"attempt_id", "payload_hash", "approved"} or data["approved"] is not True:
            return JsonResponse({"error": "Explicit approval of the validated sample is required."}, status=403)
        attempt = SandboxAttempt.objects.get(id=data["attempt_id"], session_key=request.session.session_key)
    except (ValueError, UnicodeDecodeError, ValidationError, SandboxAttempt.DoesNotExist):
        return JsonResponse({"error": "Unknown sample for this session."}, status=404)
    if attempt.payload_hash != data["payload_hash"]:
        return JsonResponse({"error": "The approved payload hash does not match."}, status=409)
    if attempt.created_at < timezone.now() - timedelta(minutes=5):
        return JsonResponse({"error": "Approval expired. Generate and validate a fresh sample."}, status=409)
    serializer = IdxSampleSerializer(data=attempt.payload)
    if not serializer.is_valid():
        return JsonResponse({"error": "The sample expired or no longer validates."}, status=409)
    try:
        config = load_credentials()
    except ConfigurationError as exc:
        return JsonResponse({"error": str(exc)}, status=503)
    # A single SQL update claims this attempt, including across concurrent requests.
    claimed = SandboxAttempt.objects.filter(id=attempt.id, state="validated").update(state="submitting")
    if not claimed:
        attempt.refresh_from_db()
        return JsonResponse({"error": "This attempt was already submitted. No second request sent.",
                             "attempt": public_attempt(attempt)}, status=409)
    try:
        state, evidence = submit_idx(attempt.payload, config)
    except Exception:
        # Never expose credentials through Django's development exception page.
        state, evidence = "transport_unknown", {"message": "Submission ended without verifiable evidence; do not retry automatically."}
    attempt.state, attempt.evidence = state, evidence
    attempt.finished_at = timezone.now()
    attempt.save(update_fields=["state", "evidence", "finished_at"])
    return JsonResponse(public_attempt(attempt))


@local_tester
@require_GET
def result(request, attempt_id):
    try:
        attempt = SandboxAttempt.objects.get(id=attempt_id, session_key=request.session.session_key)
    except SandboxAttempt.DoesNotExist:
        raise Http404()
    return JsonResponse(public_attempt(attempt))
