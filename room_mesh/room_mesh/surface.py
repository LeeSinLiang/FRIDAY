"""RGB-D fusion and visibility-tested photographic texture projection."""
import json
from pathlib import Path

import numpy as np
import open3d as o3d
from PIL import Image
import trimesh

from .geometry import calibration, load_prediction, project


def fuse(data, scale, voxel_size, confidence_percentile, max_depth):
    volume = o3d.pipelines.integration.ScalableTSDFVolume(
        voxel_length=voxel_size, sdf_trunc=voxel_size*4,
        color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8)
    coverage = []
    for i, depth in enumerate(data['depth']):
        conf = data['confidence'][i]
        valid = np.isfinite(depth) & (depth > 0) & np.isfinite(conf) & (conf > 0)
        if not valid.any():
            coverage.append(0.0)
            continue
        valid &= conf >= np.percentile(conf[valid], confidence_percentile)
        valid &= depth * scale <= max_depth
        coverage.append(float(valid.mean()))
        if not valid.any():
            continue
        metric_depth = np.where(valid, depth*scale, 0).astype(np.float32)
        rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
            o3d.geometry.Image(np.ascontiguousarray(data['images'][i])),
            o3d.geometry.Image(metric_depth), depth_scale=1.0,
            depth_trunc=max_depth, convert_rgb_to_intensity=False)
        k = data['intrinsics'][i]
        h,w = depth.shape
        camera = o3d.camera.PinholeCameraIntrinsic(w,h,k[0,0],k[1,1],k[0,2],k[1,2])
        e = np.eye(4)
        e[:3] = data['extrinsics'][i]
        e[:3,3] *= scale
        volume.integrate(rgbd, camera, e)
    mesh = volume.extract_triangle_mesh()
    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_unreferenced_vertices()
    if len(mesh.triangles) < 1:
        raise ValueError("Fusion produced no surfaces. Check scale, poses, depth, confidence and voxel size.")
    mesh.compute_vertex_normals()
    return mesh, volume.extract_point_cloud(), coverage


def texture_scene(mesh, data, scale, tolerance, atlas_size=4096):
    vertices = np.asarray(mesh.vertices)
    faces = np.asarray(mesh.triangles)
    triangles = vertices[faces] / scale
    centers = triangles.mean(axis=1)
    # Sample corners AND centroid. Reject faces that cross depth discontinuities.
    samples = np.concatenate([triangles, centers[:,None,:]], axis=1)
    best = np.full(len(faces), np.inf)
    selected = np.full(len(faces), -1, dtype=int)
    selected_uv = np.zeros((len(faces),3,2))
    n,h,w,_ = data['images'].shape
    for i in range(n):
        uv,z = project(samples.reshape(-1,3), data['extrinsics'][i], data['intrinsics'][i])
        uv, z = uv.reshape(-1,4,2), z.reshape(-1,4)
        finite = np.isfinite(uv).all(axis=(1,2)) & np.isfinite(z).all(axis=1)
        inside = finite & (z > 0).all(axis=1) & (uv[:,:,0] >= 1).all(axis=1) & (uv[:,:,0] < w-2).all(axis=1) & (uv[:,:,1] >= 1).all(axis=1) & (uv[:,:,1] < h-2).all(axis=1)
        ids = np.flatnonzero(inside)
        if not len(ids):
            continue
        pixels = np.rint(uv[ids]).astype(int)
        measured = data['depth'][i,pixels[:,:,1],pixels[:,:,0]]
        confidence = data['confidence'][i,pixels[:,:,1],pixels[:,:,0]]
        consistent = (np.isfinite(measured) & (measured > 0) & np.isfinite(confidence) & (confidence > 0) & (np.abs(measured-z[ids])*scale <= tolerance)).all(axis=1)
        ids = ids[consistent]
        if not len(ids):
            continue
        # Prefer large projected triangle areas: more source pixels per surface.
        a,b = uv[ids,1]-uv[ids,0], uv[ids,2]-uv[ids,0]
        area = np.abs(a[:,0]*b[:,1]-a[:,1]*b[:,0])
        scores = 1.0 / np.maximum(area,1e-9)
        improved = scores < best[ids]
        ids, scores = ids[improved], scores[improved]
        best[ids], selected[ids], selected_uv[ids] = scores, i, uv[ids,:3]
    columns = int(np.ceil(np.sqrt(n)))
    rows = int(np.ceil(n / columns))
    cell_w = min(w, atlas_size // columns)
    cell_h = min(h, atlas_size // rows)
    if min(cell_w,cell_h) < 4:
        raise ValueError("Too many views for texture atlas")
    atlas = Image.new('RGB',(columns*cell_w,rows*cell_h))
    for i, rgb in enumerate(data['images']):
        atlas.paste(Image.fromarray(rgb).resize((cell_w,cell_h),Image.Resampling.LANCZOS),
                    ((i % columns)*cell_w,(i // columns)*cell_h))
    scene = trimesh.Scene()
    ids = np.flatnonzero(selected >= 0)
    if len(ids):
        # Separate vertices at photographic seams; each triangle references one frame.
        uv = selected_uv[ids].copy()
        uv[:,:,0] = (uv[:,:,0]+.5)/w*cell_w + (selected[ids,None] % columns)*cell_w
        uv[:,:,1] = (uv[:,:,1]+.5)/h*cell_h + (selected[ids,None] // columns)*cell_h
        uv[:,:,0] /= atlas.width
        uv[:,:,1] = 1 - uv[:,:,1]/atlas.height
        material = trimesh.visual.material.PBRMaterial(baseColorTexture=atlas,
            metallicFactor=0, roughnessFactor=1, doubleSided=True)
        textured = trimesh.Trimesh(vertices=vertices[faces[ids]].reshape(-1,3),
            faces=np.arange(len(ids)*3).reshape(-1,3), process=False,
            visual=trimesh.visual.TextureVisuals(uv=uv.reshape(-1,2), material=material))
        scene.add_geometry(textured, node_name='room_textured', geom_name='room_textured')
    fallback = np.flatnonzero(selected < 0)
    if len(fallback):
        colors = (np.clip(np.asarray(mesh.vertex_colors),0,1)*255).astype(np.uint8)
        plain = trimesh.Trimesh(vertices=vertices, faces=faces[fallback], vertex_colors=colors, process=False)
        plain.remove_unreferenced_vertices()
        scene.add_geometry(plain, node_name='room_fused_color', geom_name='room_fused_color')
    return scene, atlas, float(len(ids)/len(faces))


def build(prediction: Path, output: Path, calibration_path: Path | None,
          allow_unscaled=False, voxel_size=.025, max_depth=12., confidence_percentile=20.,
          visual_triangles=150000, collision_triangles=10000, atlas_size=4096):
    if calibration_path is None and not allow_unscaled:
        raise ValueError("Metric export requires --calibration; use --allow-unscaled only for inspection")
    for value in (voxel_size, max_depth):
        if not np.isfinite(value) or value <= 0:
            raise ValueError("Voxel size and max depth must be positive finite numbers")
    if not 0 <= confidence_percentile < 100 or min(visual_triangles,collision_triangles) < 4 or atlas_size < 64:
        raise ValueError("Invalid confidence percentile, triangle budget or atlas size")
    data = load_prediction(prediction)
    scale, transform, meta = calibration(data, calibration_path)
    output.mkdir(parents=True, exist_ok=False)
    print("Fusing depth views into a TSDF surface", flush=True)
    mesh, cloud, coverage = fuse(data, scale, voxel_size, confidence_percentile, max_depth)
    if len(mesh.triangles) > visual_triangles:
        mesh = mesh.simplify_quadric_decimation(visual_triangles)
        mesh.compute_vertex_normals()
    print(f"Projecting textures onto {len(mesh.triangles):,} triangles", flush=True)
    visual, atlas, textured_fraction = texture_scene(mesh,data,scale,voxel_size*4,atlas_size)
    collision = mesh.simplify_quadric_decimation(collision_triangles) if len(mesh.triangles) > collision_triangles else mesh
    collider = trimesh.Trimesh(vertices=np.asarray(collision.vertices), faces=np.asarray(collision.triangles),process=False)
    # Fusion already applied scale. Apply only world orientation/origin here.
    output_transform = transform.copy()
    output_transform[:3,:3] /= scale
    visual.apply_transform(output_transform)
    collider.apply_transform(output_transform)
    cloud.transform(output_transform)
    visual.export(output / 'room.glb')
    collider.export(output / 'collision.glb')
    if not o3d.io.write_point_cloud(str(output / 'dense.ply'),cloud):
        raise OSError("Could not write dense point cloud")
    atlas.save(output / 'texture-atlas.jpg',quality=95)
    # Camera matrices map exported world positions to cameras in the SAME units.
    cameras = np.repeat(np.eye(4)[None],len(data['extrinsics']),axis=0)
    cameras[:,:3] = data['extrinsics']
    cameras = cameras @ np.linalg.inv(transform)
    cameras[:,:3] *= scale
    np.savez_compressed(output / 'cameras.npz',world_to_camera=cameras,
                        intrinsics=data['intrinsics'], native_to_output=transform)
    report = dict(schema_version=1, status='complete', **meta,
        source_prediction=str(prediction.resolve()),
        artifacts=dict(visual='room.glb',collision='collision.glb',point_cloud='dense.ply',cameras='cameras.npz'),
        frame_count=len(data['depth']), visual_triangles=sum(len(g.faces) for g in visual.geometry.values()),
        collision_triangles=len(collider.faces), bounds=collider.bounds.tolist(),
        texture_coverage_fraction=textured_fraction, retained_depth_fraction_by_frame=coverage,
        voxel_size=voxel_size, max_depth=max_depth, confidence_percentile=confidence_percentile,
        spatial_validation_ready=False, unknown_space_policy='Unobserved space is unknown, never free.',
        limitations=["Scale is based on a user reference, not independently measured accuracy.",
                    "No automatic wall/floor/door semantics or certified free-space map.",
                    "Thin, reflective, occluded and textureless surfaces may be missing or distorted.",
                    "Decimation is not a conservative collision envelope; review against detailed mesh.",
                    "Texture projection can contain seams; no global exposure optimization."])
    (output / 'manifest.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    return report
