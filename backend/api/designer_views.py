from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from catalogue.views import FailOpenThrottle
from . import designer_jobs, designer_variants
from .scene_service import SceneError
from .scene_views import anonymous_csrf, execute, room_id
from shopping.identity import current
from shopping.models import ShoppingSession


class DesignerThrottle(FailOpenThrottle):
    scope = 'designer'
    rate = '10/min'

    def get_cache_key(self, request, view):
        # Apply the cap to signed-in and guest callers alike.
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([DesignerThrottle])
def designer(request):
    session, authorize = scope(request)
    response = execute(lambda: designer_jobs.begin(session, room_id(request), request.data, authorize))
    response['Cache-Control'] = 'private, no-store'
    return response


def scope(request):
    # This endpoint deliberately lives outside /api/scene/'s request-long
    # transaction. Recheck ownership under the cart lock at every short write.
    shopping = current(request)
    user_id = request.user.pk if request.user.is_authenticated else None
    def authorize():
        live = ShoppingSession.objects.select_for_update().get(pk=shopping.pk)
        if live.owner_id is not None and live.owner_id != user_id:
            raise SceneError('ownership_conflict', 'This room now belongs to another account. Reload before editing.', 409)
    return shopping.scene_key, authorize


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def designer_poll(request, job_id):
    session, authorize = scope(request)
    response = execute(lambda: designer_jobs.poll(session, room_id(request), job_id, authorize))
    response['Cache-Control'] = 'private, no-store'
    return response


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([DesignerThrottle])
def variants(request):
    session, authorize = scope(request)
    response = execute(lambda: designer_variants.begin(session, room_id(request), request.data, authorize))
    response['Cache-Control'] = 'private, no-store'
    return response


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def variants_poll(request, job_id):
    session, authorize = scope(request)
    response = execute(lambda: designer_variants.poll(session, room_id(request), job_id, authorize))
    response['Cache-Control'] = 'private, no-store'
    return response


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def variants_refine(request, job_id):
    session, authorize = scope(request)
    response = execute(lambda: designer_variants.refine(session, room_id(request), job_id, request.data, authorize))
    response['Cache-Control'] = 'private, no-store'
    return response
