"""Render missing catalogue previews from the exact deployed GLB, without altering models.

Run: blender -b --python scripts/render_catalogue_thumbnails.py
Existing artist thumbnails are preserved. The generated manifest is a frontend image fallback;
it does not change the shared Elasticsearch index or catalogue contracts.
"""
import json
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
items = json.loads((ROOT / "backend/catalogue/data/listings.json").read_text())["items"]
manifest = {}
for item in items:
    url = item.get("model_url")
    if not url or not url.startswith("/models/furniture/"):
        continue
    model = ROOT / "shared" / url.lstrip("/")
    thumbnail = model.with_name("thumbnail.png")
    if not thumbnail.exists():
        if not model.is_file():
            print(f"SKIP missing model: {item['id']}", flush=True)
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(model))
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
        if not points:
            continue
        lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
        hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
        center = (lo + hi) / 2
        extent = max(hi - lo)
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 12
        scene.cycles.use_denoising = True
        scene.render.resolution_x = 384
        scene.render.resolution_y = 300
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = True
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.world = bpy.data.worlds.new("Preview studio")
        scene.world.use_nodes = True
        scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
        scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
        bpy.ops.object.camera_add(location=center + Vector((1.15, -2.4, 1.15)).normalized() * extent * 4)
        camera = bpy.context.object
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera.data.type = "ORTHO"
        camera.data.clip_end = max(1000, extent * 20)
        scene.camera = camera
        bpy.context.view_layer.update()
        local = [camera.matrix_world.inverted() @ p for p in points]
        width = max(p.x for p in local) - min(p.x for p in local)
        height = max(p.y for p in local) - min(p.y for p in local)
        camera.data.ortho_scale = max(width, height * 384 / 300) * 1.18
        for delta, power in [((-3, -4, 6), 450), ((4, -1, 3), 180)]:
            bpy.ops.object.light_add(type="AREA", location=center + Vector(delta) * extent)
            light = bpy.context.object
            light.data.energy = power * extent * extent
            light.data.shape = "DISK"
            light.data.size = extent * 4
            light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(thumbnail)
        bpy.ops.render.render(write_still=True)
        print(f"RENDERED {item['id']}", flush=True)
    manifest[url] = url.rsplit("/", 1)[0] + "/thumbnail.png"
(ROOT / "shared/catalogue-thumbnails.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Catalogue thumbnail manifest: {len(manifest)} models", flush=True)
