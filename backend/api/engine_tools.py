"""SDK-independent tools; a trusted request adapter supplies the current session key.

Never accept session_key directly from model arguments. These wrappers do not
install or invoke an agent SDK, and they cannot access another session's scene.
"""
import base64
import uuid

from django.db import OperationalError

from .capture_service import enqueue_capture, get_capture, metadata
from .scene_service import SceneError, attempt_placement, scene_for_session, serialize


def _result(operation):
    try:
        return operation()
    except SceneError as error:
        result = {'ok': False, 'error': {'code': error.code, 'message': error.message}}
        if error.details is not None:
            result['error']['details'] = error.details
        if error.revision is not None:
            result['revision'] = error.revision
        return result
    except OperationalError:
        return {'ok': False, 'error': {'code': 'unavailable', 'message': 'Scene storage is busy. Please retry.'}}


def try_place(session_key, instance, base_revision, command_id, dry_run=False, room_id='demo-room'):
    """Validate or apply one placement; failures are data rather than exceptions."""
    return _result(lambda: attempt_placement(session_key, {
        'instance': instance, 'baseRevision': base_revision,
        'commandId': command_id, 'dryRun': dry_run,
    }, room_id))


def get_scene_context(session_key, room_id='demo-room'):
    """Read authoritative dimensions, floor references, objects and geometry revision.

    The request adapter supplies session_key, as with try_place. Prepared building
    floors expose room.scan.building; poses remain centimetres in that floor's
    local frame. This does not install a tool into the separate shopping agent.
    """
    def read():
        from .support_context import scene_references
        snapshot = serialize(scene_for_session(session_key, room_id))
        return {'ok': True, **snapshot, 'references': scene_references(snapshot)}
    return _result(read)


def request_scene_capture(session_key, base_revision, request_id, view='perspective', camera=None, width=1024, height=768, room_id='demo-room', representation=None):
    """Queue a browser-rendered view of the requested persisted scene revision."""
    payload = {'baseRevision': base_revision, 'requestId': request_id, 'view': view, 'width': width, 'height': height}
    if camera is not None:
        payload['camera'] = camera
    if representation is not None:
        payload['representation'] = representation
    return _result(lambda: {'ok': True, **enqueue_capture(session_key, payload, room_id)})


def read_scene_capture(session_key, capture_id, include_image=False, room_id='demo-room'):
    """Poll a capture; optionally supply its PNG directly to an agent image input.

    Pending/rendering jobs return ok:true and their status. Failed jobs return
    ok:false and the renderer/timeout error. Ready jobs may include imageDataUrl.
    """
    def read():
        if not isinstance(include_image, bool):
            raise SceneError('validation', 'include_image must be boolean.')
        if not isinstance(capture_id, (str, uuid.UUID)):
            raise SceneError('validation', 'capture_id must be a UUID.')
        try:
            identifier = uuid.UUID(str(capture_id))
        except (ValueError, AttributeError):
            raise SceneError('validation', 'capture_id must be a UUID.')
        job = get_capture(session_key, identifier, room_id)
        result = {'ok': job.status != 'failed', **metadata(job)}
        if include_image and job.status == 'ready':
            result['imageDataUrl'] = 'data:image/png;base64,' + base64.b64encode(bytes(job.image)).decode('ascii')
        return result
    return _result(read)
