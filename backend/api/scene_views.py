from django.db import OperationalError
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .scene_service import SceneError, apply_scene_commands, layout_key, room_presets, save_scene, scene_for_session, serialize


def anonymous_csrf(view):
    # Do not copy DRF's csrf_exempt attribute: the outer Django wrapper must
    # enforce CSRF for anonymous session-scoped writes as well as signed-in users.
    @csrf_protect
    def guarded(request, *args, **kwargs):
        return view(request, *args, **kwargs)

    def respond(request, *args, **kwargs):
        response = guarded(request, *args, **kwargs)
        if response.status_code == 403 and not response.get('Content-Type', '').startswith('application/json'):
            return JsonResponse({'ok': False, 'error': {'code': 'csrf', 'message': 'Refresh the scene and send its CSRF token.'}}, status=403)
        return response
    # The global middleware would otherwise reject first with its HTML response;
    # guarded explicitly enforces the identical Django CSRF check inside.
    respond.csrf_exempt = True
    return respond


ROOM_COOKIE = 'friday_room'


def session_key(request):
    if not request.session.session_key:
        request.session.create()
    # Every scene endpoint keys its storage off this value, so choosing the room here moves the whole
    # API (layout, commands, placement, captures) to that room's layout with no other change.
    room_id = request.COOKIES.get(ROOM_COOKIE) or None
    return layout_key(request.session.session_key, room_id if room_id in room_presets() else None)


def execute(callback, status=200, explicit=False):
    try:
        return Response(callback(), status=status)
    except SceneError as error:
        payload = {'error': {'code': error.code, 'message': error.message}}
        if explicit:
            payload['ok'] = False
        if error.details is not None:
            payload['error']['details'] = error.details
        if error.revision is not None:
            payload['revision'] = error.revision
        return Response(payload, status=error.status)
    except OperationalError:
        payload = {'error': {'code': 'unavailable', 'message': 'Scene storage is busy. Please retry.'}}
        if explicit:
            payload['ok'] = False
        return Response(payload, status=503)


@ensure_csrf_cookie
@anonymous_csrf
@api_view(['GET', 'PUT'])
@permission_classes([AllowAny])
def scene(request):
    key = session_key(request)
    if request.method == 'GET':
        return execute(lambda: serialize(scene_for_session(key)))
    if not isinstance(request.data, dict) or set(request.data) != {'baseRevision', 'instances'}:
        return Response({'error': {'code': 'validation', 'message': 'Provide baseRevision and instances.'}}, status=400)
    return execute(lambda: save_scene(key, request.data['baseRevision'], request.data['instances']))


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def scene_commands(request):
    if not isinstance(request.data, dict) or set(request.data) != {'baseRevision', 'commandId', 'commands'}:
        return Response({'error': {'code': 'validation', 'message': 'Provide baseRevision, commandId, and commands.'}}, status=400)
    return execute(lambda: apply_scene_commands(session_key(request), request.data['baseRevision'], request.data['commandId'], request.data['commands']))


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def scene_placement(request):
    from .scene_service import attempt_placement
    return execute(lambda: attempt_placement(session_key(request), request.data), explicit=True)


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def captures(request):
    from .capture_service import enqueue_capture
    return execute(lambda: enqueue_capture(session_key(request), request.data), status=202)


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def capture_claim(request):
    from .capture_service import claim_capture
    if request.data != {}:
        return Response({'error': {'code': 'validation', 'message': 'Claim body must be an empty object.'}}, status=400)
    return execute(lambda: claim_capture(session_key(request)))


@anonymous_csrf
@api_view(['POST'])
@permission_classes([AllowAny])
def capture_complete(request, capture_id):
    from .capture_service import complete_capture
    return execute(lambda: complete_capture(session_key(request), capture_id, request.data))


@api_view(['GET'])
@permission_classes([AllowAny])
def capture_detail(request, capture_id):
    from .capture_service import get_capture, metadata
    return execute(lambda: metadata(get_capture(session_key(request), capture_id)))


@api_view(['GET'])
@permission_classes([AllowAny])
def capture_image(request, capture_id):
    from .capture_service import get_capture
    try:
        job = get_capture(session_key(request), capture_id)
        if job.status != 'ready':
            raise SceneError('not_ready', 'Capture image is not ready.', 409)
        response = HttpResponse(bytes(job.image), content_type='image/png')
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
    except SceneError as error:
        return Response({'error': {'code': error.code, 'message': error.message}}, status=error.status)
