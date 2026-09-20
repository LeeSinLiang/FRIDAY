"""Review the connected Cg Arch ground floor without changing the licensed GLB.

uv run --with numpy --with shapely python scripts/prepare_cg_arch_boundaries.py [--write]
Default: check the committed spatial data against the exact reviewed source.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import Point, box
from shapely.ops import unary_union

from skyscraper.prepare import polygons, rectangle_cover, triangles

ROOT = Path(__file__).resolve().parents[1]
ROOM = ROOT / 'shared/rooms/cg-arch-interior'
SOURCE_HASH = 'f5f5ab5566ee040c400faeb8ae66ff00e8d3d12a4db1836aa312e9feb903a59c'
LEGACY_AREA = {'minXcm': 787, 'maxXcm': 1121, 'minZcm': 180, 'maxZcm': 760}


def derive(source):
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != SOURCE_HASH:
        raise ValueError('This review applies only to the original Cg Arch room.glb')
    mesh, _, _ = triangles(source)
    cross = np.cross(mesh[:, 1] - mesh[:, 0], mesh[:, 2] - mesh[:, 0])
    lengths = np.linalg.norm(cross, axis=1)
    normal_y = np.divide(cross[:, 1], lengths, out=np.zeros_like(lengths), where=lengths > 1e-10)
    floor = (normal_y > .995) & (abs(mesh[:, :, 1]).max(1) < .026)
    support = shapely.union_all(shapely.polygons(mesh[floor][:, :, [0, 2]]))
    # The source is already in metres with Y up. Project every triangle that
    # crosses 5..240 cm, conservatively including its whole footprint. Buffering
    # before union retains zero-area projections such as thin walls/glass doors.
    body = (mesh[:, :, 1].max(1) > .05) & (mesh[:, :, 1].min(1) < 2.4)
    solids = shapely.union_all(shapely.buffer(shapely.polygons(mesh[body][:, :, [0, 2]]), .01), grid_size=.0001)
    clear = support.buffer(-.01).difference(solids)
    connected = next(part for part in polygons(clear) if part.covers(Point(11, 7.35)))
    legacy = box(7.87, 1.80, 11.21, 7.60)
    assert connected.covers(legacy), 'An expansion must preserve every old permitted pose'
    areas = [dict(zip(('minXcm', 'minZcm', 'maxXcm', 'maxZcm'),
                      (round(value * 100, 6) for value in rect)))
             for rect in rectangle_cover(connected, .05)]
    # Retain the exact non-grid legacy edges as well as the full-cell coverage.
    areas.append(LEGACY_AREA)
    allowed = unary_union([box(a['minXcm'] / 100, a['minZcm'] / 100,
                              a['maxXcm'] / 100, a['maxZcm'] / 100) for a in areas])
    assert allowed.difference(connected).area < 1e-8
    assert allowed.intersection(solids).area < 1e-8
    assert allowed.covers(legacy)
    # A conservative radius enclosing the 40 cm square walker must have a path
    # all the way from the spawn through the corridor to the off-centre entry.
    paths = allowed.buffer(-np.sqrt(2) * .20)
    reachable = next(part for part in polygons(paths) if part.covers(Point(11, 7.35)))
    for x, z in [(8, 4.9), (4, 4.9), (.8, 4.9), (.8, 6.5)]:
        assert reachable.covers(Point(x, z)), f'No body-clear path to {(x, z)}'
    report = {'sourceSha256': digest, 'triangles': len(mesh), 'cellSizeCm': 5,
              'bodyHeightRangeCm': [5, 240], 'barrierMarginCm': 1,
              'freeAreaM2': round(allowed.area, 6), 'legacyAreaM2': round(legacy.area, 6),
              'rectangles': len(areas), 'unsupportedM2': 0, 'blockedM2': 0,
              'legacyLostM2': 0, 'entryReachableWith40CmBody': True}
    ring_cm = lambda ring: [[round(x * 100, 6), round(z * 100, 6)] for x, z in ring.coords]
    outline = [{'outer': ring_cm(part.exterior), 'holes': [ring_cm(hole) for hole in part.interiors]}
               for part in polygons(allowed)]
    return {'freeAreas': areas, 'obstacles': []}, report, outline


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    spatial, review, outline = derive(ROOM / 'assets/room.glb')
    for name, value in [('spatial.json', spatial), ('boundary-review.json', review)]:
        path = ROOM / name
        if args.write:
            path.write_text(json.dumps(value, indent=2) + '\n')
        else:
            assert json.loads(path.read_text()) == value, f'{name} differs from the model review'
    manifest_path = ROOM / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    if args.write:
        manifest['room']['scan']['floorOutlineCm'] = outline
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    else:
        assert manifest['room']['scan']['floorOutlineCm'] == outline, 'Map must show the same permitted floor'
    print(json.dumps(review, indent=2))
