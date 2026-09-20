"""Read bounded, prepared room fixtures shared by the renderer and validator.

This is a reviewed fixture loader, not an upload endpoint or a reconstruction
pipeline. A room identifier can never select a file outside shared/rooms.
"""
import copy
import json
import math
import re
from pathlib import Path

from django.conf import settings
from .shared_data import shared_root

ROOM_ID = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$')


def finite(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def prepared_room(room_id):
    from .scene_service import SceneError
    if not isinstance(room_id, str) or not ROOM_ID.fullmatch(room_id):
        raise SceneError('unknown_room', 'Use a known prepared room ID.', 404)
    root = (shared_root() / 'rooms').resolve()
    directory = (root / room_id).resolve()
    if directory.parent != root or not (directory / 'manifest.json').is_file():
        raise SceneError('unknown_room', 'Prepared room not found.', 404)
    try:
        manifest = json.loads((directory / 'manifest.json').read_text())
        room = copy.deepcopy(manifest['room'])
        if room['roomId'] != room_id or not isinstance(room['revision'], int) or isinstance(room['revision'], bool):
            raise ValueError('Room identity is invalid')
        if any(not finite(room[key]) or room[key] <= 0 for key in ['widthCm', 'depthCm', 'heightCm']):
            raise ValueError('Room dimensions are invalid')
        scan = room['scan']
        if not isinstance(scan['geometryRevision'], str) or not 1 <= len(scan['geometryRevision']) <= 128:
            raise ValueError('Geometry revision is missing')
        if scan['calibration']['status'] not in ('confirmed', 'synthetic_demo', 'unconfirmed'):
            raise ValueError('Calibration status is invalid')
        spatial_path = (directory / manifest['spatialFile']).resolve()
        if spatial_path.parent != directory or spatial_path.suffix != '.json':
            raise ValueError('Spatial file must belong to this room')
        spatial = json.loads(spatial_path.read_text())
        areas, obstacles = spatial['freeAreas'], spatial['obstacles']
        if not isinstance(areas, list) or len(areas) > 256 or not isinstance(obstacles, list) or len(obstacles) > 512:
            raise ValueError('Spatial fixture is too large')
        for area in areas:
            if any(not finite(area[key]) for key in ['minXcm', 'maxXcm', 'minZcm', 'maxZcm']):
                raise ValueError('Free-area bounds are invalid')
            if not (0 <= area['minXcm'] < area['maxXcm'] <= room['widthCm'] and 0 <= area['minZcm'] < area['maxZcm'] <= room['depthCm']):
                raise ValueError('Free areas must be inside the room')
        ids = set()
        for obstacle in obstacles:
            identifier = obstacle['obstacleId']
            if not isinstance(identifier, str) or not identifier or len(identifier) > 128 or identifier in ids:
                raise ValueError('Obstacle identifiers must be unique')
            ids.add(identifier)
            if any(not finite(obstacle[key]) for key in ['xCm', 'zCm', 'yawRad', 'widthCm', 'depthCm']):
                raise ValueError('Obstacle geometry is invalid')
            if obstacle['widthCm'] <= 0 or obstacle['depthCm'] <= 0 or not isinstance(obstacle['label'], str):
                raise ValueError('Obstacle bounds or label are invalid')
        room['spatial'] = spatial
        return room
    except (OSError, ValueError, KeyError, TypeError, OverflowError):
        raise SceneError('room_unavailable', 'The prepared room geometry is invalid or unavailable.', 503)
