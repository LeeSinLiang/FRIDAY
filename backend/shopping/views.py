from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from accounts.policy import account_status
from api.scene_views import anonymous_csrf, execute
from api.scene_service import SceneError
from checkout.views import public
from . import services, identity


def ready(request):
    state = account_status(request.user)
    if not state['checkout_ready'] or not state['recovery_acknowledged']:
        raise SceneError('account_required', 'Sign in, verify your email, finish MFA and acknowledge your recovery codes first.', 401)


@ensure_csrf_cookie
@api_view(['GET'])
@permission_classes([AllowAny])
def detail(request):
    return execute(lambda: services.cart(identity.current(request), request.user))


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def confirm(request):
    return execute(lambda: services.confirm(identity.current(request), request.data))


@anonymous_csrf
@api_view(['DELETE'])
@permission_classes([AllowAny])
def remove(request, item_id):
    return execute(lambda: services.remove(identity.current(request), item_id, revision(request)))


def revision(request):
    if not isinstance(request.data, dict):
        raise SceneError('validation', 'Provide the current cart revision.')
    return request.data.get('revision')


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def claim(request):
    def action():
        ready(request)
        return services.cart(identity.claim(request), request.user)
    return execute(action)


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def checkout(request):
    def action():
        ready(request)
        return public(services.checkout(identity.current(request), request.user, revision(request)))
    return execute(action, status=201)


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def lock_design(request):
    return execute(lambda: services.lock_design(identity.current(request), request.data))
