"""Validated RGB-D interchange, scale calibration, and world transforms."""
import json
from pathlib import Path

import numpy as np


def load_prediction(path: Path):
    with np.load(path, allow_pickle=False) as archive:
        data = {key: archive[key] for key in ('images', 'depth', 'confidence', 'extrinsics', 'intrinsics')}
    rgb, depth = data['images'], data['depth']
    if depth.ndim != 3 or depth.shape[0] < 2 or min(depth.shape[1:]) < 8:
        raise ValueError("depth must have shape (N>=2, H>=8, W>=8)")
    n, h, w = depth.shape
    shapes = dict(images=(n,h,w,3), confidence=(n,h,w), extrinsics=(n,3,4), intrinsics=(n,3,3))
    for key, shape in shapes.items():
        if data[key].shape != shape:
            raise ValueError(f"{key}: expected {shape}, got {data[key].shape}")
    if rgb.dtype != np.uint8:
        raise ValueError("images must be uint8 RGB aligned to the depth/intrinsics resolution")
    for key in ('intrinsics', 'extrinsics'):
        if not np.isfinite(data[key]).all():
            raise ValueError(f"Nonfinite {key}")
    k = data['intrinsics']
    if np.any(k[:,0,0] <= 0) or np.any(k[:,1,1] <= 0) or not np.allclose(k[:,2,:], [0,0,1]):
        raise ValueError("Invalid pinhole intrinsics")
    if not np.allclose(k[:,0,1], 0) or not np.allclose(k[:,1,0], 0):
        raise ValueError("Skewed camera intrinsics are unsupported")
    r = data['extrinsics'][:,:,:3]
    if not np.allclose(r @ r.transpose(0,2,1), np.eye(3), atol=1e-3) or not np.allclose(np.linalg.det(r),1,atol=1e-3):
        raise ValueError("Extrinsics must be rigid world-to-camera transforms")
    return data


def unproject(data, frame, pixel):
    if not isinstance(frame, int) or isinstance(frame, bool) or not 0 <= frame < len(data['depth']):
        raise ValueError("Calibration frame is out of range")
    xy = np.asarray(pixel, dtype=float)
    if xy.shape != (2,) or not np.isfinite(xy).all():
        raise ValueError("Calibration pixels must be [x,y]")
    x, y = np.rint(xy).astype(int)
    h, w = data['depth'].shape[1:]
    if not (0 <= x < w and 0 <= y < h):
        raise ValueError("Calibration pixel is outside the processed view")
    z = float(data['depth'][frame,y,x])
    confidence = float(data['confidence'][frame,y,x])
    if not np.isfinite(z) or z <= 0 or not np.isfinite(confidence) or confidence <= 0:
        raise ValueError("Calibration pixel has invalid depth/confidence")
    camera = np.linalg.solve(data['intrinsics'][frame], [x,y,1]) * z
    e = data['extrinsics'][frame]
    return e[:,:3].T @ (camera - e[:,3])


def calibration(data, path: Path | None):
    """Native reconstruction -> meters, Y-up. Floor alignment is explicitly supplied."""
    config = json.loads(path.read_text()) if path else {}
    if path:
        reference = config['reference']
        distance = float(reference['distance_m'])
        if len(reference['points']) != 2:
            raise ValueError("Calibration requires exactly two reference points")
        a, b = [unproject(data, p['frame'], p['pixel']) for p in reference['points']]
        native_distance = float(np.linalg.norm(a-b))
        if not np.isfinite(distance) or distance <= 0 or native_distance < 1e-6:
            raise ValueError("Reference distance must be positive and endpoints distinct")
        scale = distance / native_distance
    else:
        scale = 1.0
    up = np.asarray(config.get('up', [0,-1,0]), dtype=float)
    origin = np.asarray(config.get('origin', [0,0,0]), dtype=float)
    if up.shape != (3,) or origin.shape != (3,) or not np.isfinite(up).all() or not np.isfinite(origin).all() or np.linalg.norm(up) < 1e-8:
        raise ValueError("up must be a finite nonzero vector; origin must be a finite 3-vector")
    y = up / np.linalg.norm(up)
    seed = np.array([1.,0,0]) if abs(y[0]) < .9 else np.array([0.,0,1])
    x = seed - y * np.dot(seed, y)
    x /= np.linalg.norm(x)
    rotation = np.stack([x, y, np.cross(x,y)])
    transform = np.eye(4)
    transform[:3,:3] = rotation * scale
    transform[:3,3] = -rotation @ origin * scale
    return scale, transform, dict(units='meters' if path else 'arbitrary',
        scale_m_per_native_unit=scale if path else None,
        scale_source='user-measured reference' if path else 'uncalibrated',
        floor_alignment_supplied=('up' in config and 'origin' in config),
        native_to_output=transform.tolist(), reference=config.get('reference'))


def project(points, extrinsic, intrinsic):
    camera = points @ extrinsic[:,:3].T + extrinsic[:,3]
    homogeneous = camera @ intrinsic.T
    with np.errstate(divide='ignore', invalid='ignore'):
        uv = homogeneous[:,:2] / homogeneous[:,2,None]
    return uv, camera[:,2]
