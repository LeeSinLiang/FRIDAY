from django.db import OperationalError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .scene_service import SceneError, apply_scene_commands, save_scene, scene_for_session, serialize


def anonymous_csrf(view):
    # Do not copy DRF's csrf_exempt attribute: the outer Django wrapper must
    # enforce CSRF for anonymous session-scoped writes as well as signed-in users.
    @csrf_protect
    def guarded(request, *args, **kwargs):
        return view(request, *args, **kwargs)

    def respond(request, *args, **kwargs):
        response = guarded(request, *args, **kwargs)
        if response.status_code == 403 and not response.get('Content-Type', '').startswith('application/json'):
            return JsonResponse({'error': {'code': 'csrf', 'message': 'Refresh the scene and send its CSRF token.'}}, status=403)
        return response
    # The global middleware would otherwise reject first with its HTML response;
    # guarded explicitly enforces the identical Django CSRF check inside.
    respond.csrf_exempt = True
    return respond


def session_key(request):
    if not request.session.session_key:
        request.session.create()
    return request.session.session_key


def execute(callback):
    try:
        return Response(callback())
    except SceneError as error:
        payload = {'error': {'code': error.code, 'message': error.message}}
        if error.revision is not None:
            payload['revision'] = error.revision
        return Response(payload, status=error.status)
    except OperationalError:
        return Response({'error': {'code': 'unavailable', 'message': 'Scene storage is busy. Please retry.'}}, status=503)


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
