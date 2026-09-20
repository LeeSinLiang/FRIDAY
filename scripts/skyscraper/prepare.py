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
import shapely
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from api.glb import read_glb, node_matrix

SOURCE_HASH = '0d4d516057aa6b8e6a79cdbd0b3446432edd831a151206c2c1879e944dc87de9'
OWNER = 'london-skyscraper-test'
BUILDING = 'london-skyscraper'
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
    result, owners = [], []
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
            owners.extend([node.get('name', '')] * (len(indices) // 3))
        for child in node.get('children', []):
            visit(child, world)
    for index in document['scenes'][document.get('scene', 0)]['nodes']:
        visit(index, np.eye(4))
    return np.concatenate(result), document, np.array(owners)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n')


def rectangle_cover(shape, step):
    """Conservative complete-cell coverage, merged into the existing rectangle contract.

    No sampled cell centers: every corner, edge and interior must be in clear floor.
    Adjacent rectangles remain a union in the existing backend/frontend validator.
    """
    minx, minz, maxx, maxz = shape.bounds
    xs = np.arange(np.floor(minx / step) * step, np.ceil(maxx / step) * step, step)
    zs = np.arange(np.floor(minz / step) * step, np.ceil(maxz / step) * step, step)
    x, z = np.meshgrid(xs, zs)
    shapely.prepare(shape)
    mask = shapely.covers(shape, shapely.box(x, z, x + step, z + step))
    done, active = [], {}
    for j, row in enumerate(mask):
        edges = np.diff(np.r_[False, row, False].astype(int))
        current = {}
        for left, right in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)):
            key = (int(left), int(right))
            current[key] = active.pop(key, [float(xs[left]), float(zs[j]), float(xs[right-1] + step), 0])
            current[key][3] = float(zs[j] + step)
        done.extend(active.values())
        active = current
    return done + list(active.values())


def polygons(shape):
    return [shape] if shape.geom_type == 'Polygon' else [p for p in shape.geoms if p.geom_type == 'Polygon']


def supported_pose(covered, target, width, depth):
    # Find a real supported footprint near the intended view, including across cell seams.
    options = [(x, z) for x in np.arange(covered.bounds[0], covered.bounds[2], .25)
               for z in np.arange(covered.bounds[1], covered.bounds[3], .25)]
    for x, z in sorted(options, key=lambda p: (p[0]-target[0])**2 + (p[1]-target[1])**2):
        if covered.covers(box(x-width/2, z-depth/2, x+width/2, z+depth/2)):
            return x, z
    raise ValueError('No supported camera/reference footprint')


def prepare(source):
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_HASH:
        raise ValueError('Source hash differs: review floor geometry before preparing another model')
    t, document, owners = triangles(source)
    cross = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    lengths = np.linalg.norm(cross, axis=1)
    ny = np.divide(cross[:, 1], lengths, out=np.zeros_like(lengths), where=lengths > 1e-12)
    mean_y = t[:, :, 1].mean(1)
    report = json.loads((ROOT / 'docs/evidence/skyscraper-floor-probe.json').read_text())['diagnostic']
    if report['source_sha256'] != SOURCE_HASH:
        raise ValueError('Floor candidates must match the reviewed source')
    # The original Interior_Top filter omitted both entrance levels. Named source
    # meshes distinguish interior floor from the sidewalk at the same elevation.
    candidates = [
        {'candidate_id': 'G00', 'elevation_m': -4.21677, 'mesh': 'Lobby_Floor', 'label': 'Entrance lobby'},
        {'candidate_id': 'M00', 'elevation_m': -.2126, 'mesh': 'Lobby_Floor', 'label': 'Lobby mezzanine'},
        *[{**r, 'mesh': 'Interior_Top', 'label': f"Tower floor {i}"}
          for i, r in enumerate(report['tower_candidates'], 1)],
    ]
    def room_id(candidate):
        return BUILDING if candidate == 'G00' else f'london-skyscraper-level-{candidate.lower()}'
    levels = [{'floorId': r['candidate_id'], 'roomId': room_id(r['candidate_id'])} for r in candidates]
    # Old contexts are immutable: existing layouts/cart references keep their original
    # coordinate systems. Full-floor geometry uses new room IDs, as persistence requires.
    legacy = [OWNER, *[f'london-skyscraper-c{i:02}' for i in range(2, 33)]]
    floors = []
    for row in candidates:
        candidate, approximate_y = row['candidate_id'], row['elevation_m']
        near = (ny > .995) & (abs(mean_y - approximate_y) < .05) & (lengths > .002) & (owners == row['mesh'])
        support = t[near]
        coverage = unary_union([Polygon(q[:, [0, 2]]) for q in support])
        low, high = float(support[:, :, 1].min()), float(support[:, :, 1].max())
        if high - low > .04:
            raise ValueError(f'{candidate}: floor is not planar enough: {high-low}')
        # Use measured overhead distance, allowing a full jump where the source
        # ceiling permits it. Every accepted cell is then checked through this height.
        clearance = 300 if candidate == 'G00' else 500 if candidate == 'M00' else int(
            (row['ceiling_distance_p05_p50_p95_m'][0] - (high-approximate_y))*100) - 1
        occupied = (t[:, :, 1].max(1) > high + .05) & (t[:, :, 1].min(1) < high + clearance/100)
        solids = unary_union([Polygon(q[:, [0, 2]]).buffer(.025) for q in t[occupied]])
        clear = coverage.buffer(-.025).difference(solids)
        # Preserve the bounded 256-area runtime contract. Adaptive resolution is
        # recorded, never expanded beyond actual support or through a fixed wall.
        for step in [.2, .25, .3, .4]:
            rectangles = rectangle_cover(clear, step)
            if len(rectangles) <= 256:
                break
        if not rectangles or len(rectangles) > 256:
            raise ValueError(f'{candidate}: cannot encode reviewed floor within runtime limits')
        covered = unary_union([box(*r) for r in rectangles])
        missing = covered.difference(coverage).area
        blocked = covered.intersection(solids).area
        if missing > 1e-6 or blocked > 1e-6:
            raise ValueError(f'{candidate}: unsafe floor: unsupported={missing}, blocked={blocked}')
        minx, minz, maxx, maxz = coverage.bounds
        ox, oz = np.floor(minx*10)/10, np.floor(minz*10)/10
        width, depth = np.ceil((maxx-ox)*100), np.ceil((maxz-oz)*100)
        camera_target = (-3, -7) if candidate == 'G00' else (1, 2) if candidate == 'M00' else (6, -4.3)
        cx, cz = supported_pose(covered, camera_target, .4, .4)
        rx, rz = supported_pose(covered, (cx, cz-3), 2, 1)
        def pose(x, z):
            return {'xCm': round((x-ox)*100, 5), 'zCm': round((z-oz)*100, 5), 'yawRad': 0}
        outline = [{'outer': [[round((x-ox)*100, 5), round((z-oz)*100, 5)] for x, z in p.exterior.coords],
                    'holes': [[[round((x-ox)*100, 5), round((z-oz)*100, 5)] for x, z in ring.coords] for ring in p.interiors]}
                   for p in polygons(coverage) if p.area > .01]
        floor = {'roomId': room_id(candidate), 'floorId': candidate, 'surfaceId': f'{candidate}:full-floor-v2',
                 'label': row['label'], 'elevationM': high, 'sourceOriginM': [float(ox), high, float(oz)],
                 'supportErrorMaxMm': round((high-low)*1000, 4), 'sourceFloorAreaM2': coverage.area,
                 'checkedAreaM2': covered.area, 'unsupportedAreaM2': missing, 'blockedAreaM2': blocked,
                 'clearanceCm': clearance, 'boundaryCellCm': step*100, 'referencePose': pose(rx, rz)}
        floors.append(floor)
        manifest = {'room': {'roomId': floor['roomId'], 'revision': 1, 'widthCm': float(width), 'depthCm': float(depth), 'heightCm': clearance,
            'scan': {'geometryRevision': f'london-{candidate.lower()}-{SOURCE_HASH[:12]}-full-v2',
                'visualFormat': 'glb', 'visualUrl': f'/rooms/{OWNER}/assets/building.glb',
                'positionCm': [float(-100*ox), -100*high, float(-100*oz)], 'rotationDeg': [0, 0, 0], 'scale': 1,
                'calibration': {'status': 'synthetic_demo', 'note': 'Source glTF metres; authored scale, not surveyed. Mesh floor outline with conservative clear-floor cells; walls, voids and low overhead geometry excluded. Levels use measured elevations.'},
                'defaultCamera': {'kind': 'firstPerson', **pose(cx, cz), 'yCm': 170, 'yawRad': float(np.pi) if candidate == 'G00' else 0, 'pitchRad': -.1, 'fovDeg': 65},
                'floorOutlineCm': outline,
                'attribution': {'title': 'Free London Skyscraper', 'author': '99.Miles', 'url': SOURCE_URL,
                                'license': 'CC BY 4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/'},
                'building': {'buildingId': BUILDING, 'sourceSha256': SOURCE_HASH, 'levels': levels,
                             'legacyRoomIds': legacy, **floor}}}, 'spatialFile': 'spatial.json', 'sharedVisualRoomId': OWNER}
        directory = ROOT / 'shared/rooms' / floor['roomId']
        write_json(directory / 'manifest.json', manifest)
        write_json(directory / 'spatial.json', {'freeAreas': [
            {'minXcm': round((x0-ox)*100, 5), 'maxXcm': round((x1-ox)*100, 5),
             'minZcm': round((z0-oz)*100, 5), 'maxZcm': round((z1-oz)*100, 5)} for x0, z0, x1, z1 in rectangles], 'obstacles': []})
        (directory / 'license.txt').write_text((ROOT / 'shared/rooms' / OWNER / 'license.txt').read_text())
        print(candidate, row['label'], 'Y', round(high, 4), 'area', round(covered.area, 2), 'rectangles', len(rectangles), flush=True)
    fixture = {'buildingId': BUILDING, 'visualRoomId': OWNER, 'legacyRoomIds': legacy, 'sourceSha256': SOURCE_HASH,
               'sourceBytes': source.stat().st_size, 'triangles': len(t), 'meshCount': len(document['meshes']),
               'materialCount': len(document.get('materials', [])),
               'boundsM': {'min': t.min(axis=(0, 1)).tolist(), 'max': t.max(axis=(0, 1)).tolist()},
               'reference': {'instanceId': 'skyscraper-scale-reference', 'productId': 'scale-reference',
                             'pose': floors[0]['referencePose'], 'sizeCm': [200, 100, 100]}, 'floors': floors}
    write_json(ROOT / 'shared/skyscraper-test-scene.json', fixture)
    destination = ROOT / 'shared/rooms' / OWNER / 'assets/building.glb'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() != SOURCE_HASH:
        raise ValueError('Refusing to replace a different local asset')
    if not destination.exists():
        shutil.copyfile(source, destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    prepare(parser.parse_args().source)
