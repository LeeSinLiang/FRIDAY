"""Prepare a local full-building GLB test, without rewriting its bytes.

Run: uv run --with numpy --with shapely python scripts/skyscraper/prepare.py SOURCE.glb
Only this reviewed source is accepted. Output metadata is reproducible; the licensed building is shipped once with the room.
"""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from api.glb import read_glb, node_matrix

SOURCE_HASH = '0d4d516057aa6b8e6a79cdbd0b3446432edd831a151206c2c1879e944dc87de9'
OWNER = 'london-skyscraper-test'
SOURCE_URL = 'https://sketchfab.com/3d-models/free-london-skyscraper-52b73f6ea18a440cb42734840d5edc72'


def triangles(source):
    document, binary = read_glb(source)
    def accessor(index):
        a = document['accessors'][index]
        v = document['bufferViews'][a['bufferView']]
        if a.get('sparse') or v.get('buffer', 0) != 0:
            raise ValueError('Unsupported accessor')
        dtype = np.dtype({5123: '<u2', 5125: '<u4', 5126: '<f4'}[a['componentType']])
        width = {'SCALAR': 1, 'VEC3': 3}[a['type']]
        return np.ndarray((a['count'], width), dtype, binary,
                          offset=v.get('byteOffset', 0) + a.get('byteOffset', 0),
                          strides=(v.get('byteStride', width * dtype.itemsize), dtype.itemsize)).copy()
    result = []
    def visit(index, parent):
        node = document['nodes'][index]
        world = parent @ np.array(node_matrix(node))
        for primitive in document['meshes'][node['mesh']]['primitives'] if 'mesh' in node else []:
            if primitive.get('mode', 4) != 4 or primitive.get('targets') or 'skin' in node:
                raise ValueError('Expected static triangles')
            vertices = accessor(primitive['attributes']['POSITION'])
            vertices = (np.c_[vertices, np.ones(len(vertices))] @ world.T)[:, :3]
            indices = accessor(primitive['indices']).ravel() if 'indices' in primitive else np.arange(len(vertices))
            result.append(vertices[indices.reshape(-1, 3)])
        for child in node.get('children', []):
            visit(child, world)
    for index in document['scenes'][document.get('scene', 0)]['nodes']:
        visit(index, np.eye(4))
    return np.concatenate(result), document


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n')


def prepare(source):
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_HASH:
        raise ValueError('Source hash differs: review floor geometry before preparing another model')
    t, document = triangles(source)
    cross = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    lengths = np.linalg.norm(cross, axis=1)
    ny = np.divide(cross[:, 1], lengths, out=np.zeros_like(lengths), where=lengths > 1e-12)
    mean_y = t[:, :, 1].mean(1)
    zone = box(4, -12, 8, -4)
    floors = []
    report = json.loads((ROOT / 'docs/evidence/skyscraper-floor-probe.json').read_text())['diagnostic']
    if report['source_sha256'] != SOURCE_HASH:
        raise ValueError('Floor candidates must match the reviewed source')
    candidates = report['tower_candidates']
    levels = [{'floorId': row['candidate_id'], 'roomId': OWNER if row['candidate_id'] == 'C01' else f"london-skyscraper-{row['candidate_id'].lower()}"} for row in candidates]
    for number, row in enumerate(candidates, 1):
        candidate, label, approximate_y = row['candidate_id'], f'Floor {number}', row['elevation_m']
        # Exact polygon coverage, not point samples: gaps between samples must also fail.
        near = (ny > .995) & (abs(mean_y - approximate_y) < .05) & (lengths > .002)
        support = [q for q in t[near] if Polygon(q[:, [0, 2]]).intersection(zone).area > 1e-8]
        coverage = unary_union([Polygon(q[:, [0, 2]]) for q in support])
        missing = zone.difference(coverage).area
        low, high = float(np.array(support)[:, :, 1].min()), float(np.array(support)[:, :, 1].max())
        # Conservative projection of all triangles intersecting the occupied height band.
        # Buffer also catches zero-area projections of vertical walls. Entire projected
        # triangles overestimate obstacles rather than approving uncertain space.
        occupied = (t[:, :, 1].max(1) > high + .005) & (t[:, :, 1].min(1) < high + 2.3)
        solids = unary_union([Polygon(q[:, [0, 2]]).buffer(.03) for q in t[occupied]])
        blocked_shape = zone.intersection(solids)
        blocked = blocked_shape.area
        parts = list(blocked_shape.geoms) if hasattr(blocked_shape, 'geoms') else [blocked_shape]
        obstacles = []
        for part in sorted((p for p in parts if p.area > 1e-8), key=lambda p: p.bounds):
            x0, z0, x1, z1 = part.bounds
            obstacles.append({'obstacleId': f'{candidate}:fixed-{len(obstacles)+1}', 'label': 'building wall',
                              'xCm': ((x0+x1)/2-3.5)*100, 'zCm': ((z0+z1)/2+12.5)*100,
                              'widthCm': (x1-x0)*100, 'depthCm': (z1-z0)*100, 'yawRad': 0})
        if missing > 1e-6 or high - low > .005:
            raise ValueError(f'{candidate}: unsafe zone: missing={missing}, blocked={blocked}, variation={high-low}')
        room_id = OWNER if candidate == 'C01' else f'london-skyscraper-{candidate.lower()}'
        floor = {'roomId': room_id, 'floorId': candidate, 'surfaceId': f'{candidate}:reviewed-floor',
                 'label': label, 'elevationM': high, 'sourceOriginM': [3.5, high, -12.5],
                 'supportErrorMaxMm': round((high-low)*1000, 4), 'checkedAreaM2': zone.area,
                 'unsupportedAreaM2': missing, 'blockedAreaM2': blocked, 'clearanceCm': 230}
        floors.append(floor)
        manifest = {'room': {'roomId': room_id, 'revision': 1, 'widthCm': 600, 'depthCm': 1000, 'heightCm': 230,
            'scan': {'geometryRevision': f'london-{candidate.lower()}-{SOURCE_HASH[:12]}-v1',
                'visualFormat': 'glb', 'visualUrl': f'/rooms/{OWNER}/assets/building.glb',
                'positionCm': [-350, -100 * high, 1250], 'rotationDeg': [0, 0, 0], 'scale': 1,
                'calibration': {'status': 'synthetic_demo', 'note': 'Source glTF metres; assumed authored scale, not surveyed dimensions. Only the geometry-checked 4 x 8 metre zone is enabled. Placement height uses this floor surface, not uniform storey spacing.'},
                'defaultCamera': {'kind': 'firstPerson', 'xCm': 250, 'yCm': 205, 'zCm': 820, 'yawRad': 0, 'pitchRad': -.29, 'fovDeg': 65},
                'attribution': {'title': 'Free London Skyscraper', 'author': '99.Miles', 'url': SOURCE_URL,
                                'license': 'CC BY 4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/'},
                'building': {'buildingId': OWNER, 'sourceSha256': SOURCE_HASH, 'levels': levels, **floor}}}, 'spatialFile': 'spatial.json'}
        if room_id != OWNER:
            manifest['sharedVisualRoomId'] = OWNER
        directory = ROOT / 'shared/rooms' / room_id
        write_json(directory / 'manifest.json', manifest)
        write_json(directory / 'spatial.json', {'freeAreas': [{'minXcm': 50, 'maxXcm': 450, 'minZcm': 50, 'maxZcm': 850}], 'obstacles': obstacles})
        (directory / 'license.txt').write_text(f'[FREE] London Skyscraper by 99.Miles\nSource: {SOURCE_URL}\nLicensed under Creative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/\nLicense/creator verified against the public Sketchfab v3 model API on 2026-09-20.\nModified by William Xu: Furniture and Lobby_Furniture removed to make an unfurnished version.\nThe supplied edited GLB is otherwise copied unchanged; FRIDAY does not alter its textures/materials.\n')
    fixture = {'buildingId': OWNER, 'sourceSha256': SOURCE_HASH, 'sourceBytes': source.stat().st_size,
               'triangles': len(t), 'meshCount': len(document['meshes']), 'materialCount': len(document.get('materials', [])),
               'boundsM': {'min': t.min(axis=(0, 1)).tolist(), 'max': t.max(axis=(0, 1)).tolist()},
               'reference': {'instanceId': 'skyscraper-scale-reference', 'productId': 'scale-reference',
                             'pose': {'xCm': 250, 'zCm': 400, 'yawRad': 0}, 'sizeCm': [200, 100, 100]}, 'floors': floors}
    write_json(ROOT / 'shared/skyscraper-test-scene.json', fixture)
    destination = ROOT / 'shared/rooms' / OWNER / 'assets/building.glb'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() != SOURCE_HASH:
        raise ValueError('Refusing to replace a different local asset')
    if not destination.exists():
        shutil.copyfile(source, destination)
    print(json.dumps(fixture, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    prepare(parser.parse_args().source)
