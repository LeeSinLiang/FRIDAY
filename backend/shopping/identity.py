"""Independent guest identity survives allauth session flushes and rotations."""
import hashlib
import secrets
from django.conf import settings
from django.db import transaction
from .models import ShoppingSession

COOKIE = 'friday_shopping'


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def current(request):
    raw = getattr(request, '_request', request)
    if hasattr(raw, '_shopping'):
        return raw._shopping
    token = request.COOKIES.get(COOKIE, '')
    query = ShoppingSession.objects.all()
    if transaction.get_connection().in_atomic_block:
        query = query.select_for_update()
    shopping = query.filter(token_hash=digest(token)).first() if token else None
    user_id = request.user.pk if request.user.is_authenticated else None
    if shopping and shopping.owner_id and shopping.owner_id != user_id:
        shopping = None
        # A previous account's scene key must never be adopted by a fresh guest.
        adopt = False
    else:
        adopt = not token
    if shopping is None:
        if not request.session.session_key:
            request.session.create()
        token = secrets.token_urlsafe(32)
        values = {'token_hash': digest(token)}
        old_key = request.session.session_key
        if adopt and old_key and not ShoppingSession.objects.filter(scene_key=old_key).exists():
            values['scene_key'] = old_key
        shopping = ShoppingSession.objects.create(**values)
        raw._shopping_cookie = token
    raw._shopping = shopping
    return shopping


@transaction.atomic
def claim(request):
    shopping = ShoppingSession.objects.select_for_update().get(pk=current(request).pk)
    if shopping.owner_id not in (None, request.user.pk):
        raise ValueError('This cart belongs to another account.')
    if shopping.owner_id is None:
        shopping.owner = request.user
        # Ownership is enforced on every request. A stable token keeps retries
        # safe even when the claim response is lost or StrictMode repeats it.
        shopping.save(update_fields=['owner'])
        raw = getattr(request, '_request', request)
        raw._shopping = shopping
    return shopping


class ShoppingCookieMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith(('/api/cart/', '/api/scene/')):
            # Hold the ownership check's row lock through mutation. A guest write
            # cannot race a claim and mutate a cart after it belongs to an account.
            with transaction.atomic():
                response = self.get_response(request)
        else:
            response = self.get_response(request)
        if hasattr(request, '_shopping_cookie'):
            response.set_cookie(COOKIE, request._shopping_cookie, httponly=True,
                                secure=not settings.DEBUG, samesite='Lax')
        if request.path.startswith(('/api/cart/', '/api/scene/', '/api/checkouts/', '/_allauth/')):
            response['Cache-Control'] = 'private, no-store'
        return response
