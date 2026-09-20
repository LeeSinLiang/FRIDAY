"""Bake static architectural illumination before running the Cg Arch GLB exporter.
Run with Blender --background --factory-startup --disable-autoexec source.blend --python this_script.py.
"""
import bpy, pathlib, runpy, ctypes, numpy as np
scene=bpy.context.scene
root=pathlib.Path(__file__).resolve().parent.parent
(root/'shared/rooms/cg-arch-interior/assets').mkdir(parents=True,exist_ok=True)
# Preserve texture coordinates when combining architectural meshes into one atlas.
white=bpy.data.materials.new('Source default white');white.use_nodes=True
bsdf=white.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value=(.8,.8,.8,1)
bsdf.inputs['Roughness'].default_value=.65
architecture=[]
for o in list(scene.objects):
 if o.type!='MESH' or o.hide_render:continue
 if o.name=='archicadobjects':
  o.hide_render=True;continue
 if not o.data.materials:o.data.materials.append(white)
 for i,material in enumerate(o.data.materials):
  if material is None:o.data.materials[i]=white
 if any(k in o.name.lower() for k in ['glass','led','spot','cylinder','magnetik','delta light','box']):continue
 if o.data.uv_layers:o.data.uv_layers.active.name='SourceUV'
 architecture.append(o)
for m in bpy.data.materials:
 if not m.use_nodes:
  source_color=tuple(m.diffuse_color);m.use_nodes=True
  principled=m.node_tree.nodes.get('Principled BSDF')
  principled.inputs['Base Color'].default_value=source_color
  principled.inputs['Metallic'].default_value=0
  principled.inputs['Roughness'].default_value=.65
 nodes=m.node_tree.nodes;links=m.node_tree.links
 uv=nodes.new('ShaderNodeUVMap');uv.uv_map='SourceUV'
 for n in list(nodes):
  if n.type=='TEX_IMAGE' and n.image:
   if not n.image.packed_file and n.image.size[0]==0:
    nodes.remove(n);continue
   if not n.inputs['Vector'].is_linked:links.new(uv.outputs['UV'],n.inputs['Vector'])
  if n.type=='TEX_COORD':
   for link in list(n.outputs['UV'].links):links.new(uv.outputs['UV'],link.to_socket)
bpy.ops.object.select_all(action='DESELECT')
for o in architecture:o.select_set(True)
bpy.context.view_layer.objects.active=architecture[0]
# Apply modifiers while materials and object transforms are still source-local.
bpy.ops.object.convert(target='MESH')
bpy.ops.object.join()
obj=bpy.context.object;obj.name='Baked fixed architecture'
for slot in obj.material_slots:
 if slot.material:
  slot.material=slot.material.copy();slot.material.name='Lightmapped | '+slot.material.name
  slot.material['fridayBakedLighting']=True
  slot.material['fridayLightMapEncoding']='rgbm'
atlas_uv=obj.data.uv_layers.new(name='LightingAtlas');obj.data.uv_layers.active=atlas_uv;atlas_uv.active_render=True
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.15192,island_margin=.003,area_weight=1)
bpy.ops.object.mode_set(mode='OBJECT')
image=bpy.data.images.new('Room baked illumination',width=2048,height=2048,alpha=False,float_buffer=True)
for m in obj.data.materials:
 if not m or not m.use_nodes:continue
 for n in m.node_tree.nodes:n.select=False
 n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=image;n.select=True;m.node_tree.nodes.active=n
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.bake.margin=12;scene.render.bake.use_clear=True
scene.render.bake.use_pass_direct=True;scene.render.bake.use_pass_indirect=True;scene.render.bake.use_pass_color=False
print('BAKING',len(obj.data.polygons),flush=True)
bpy.ops.object.bake(type='DIFFUSE',uv_layer='LightingAtlas')
# Keep a recoverable linear bake so denoiser/export retries do not repeat tracing.
image.filepath_raw=str(root/'shared/rooms/cg-arch-interior/assets/irradiance-raw.exr');image.file_format='OPEN_EXR';image.save()
bpy.data.use_autopack=False
bpy.ops.wm.save_as_mainfile(filepath=str(root/'shared/rooms/cg-arch-interior/assets/bake-checkpoint.blend'))
print('RAW_BAKE_CHECKPOINT_SAVED',flush=True)
# Cycles image baking does not apply render denoising. Filter the linear HDR
# atlas with Blender's bundled OpenImageDenoise, before the AgX display transform.
# API: https://github.com/RenderKit/oidn/blob/master/include/OpenImageDenoise/oidn.h
lib_path=pathlib.Path(bpy.app.binary_path).parent.parent/'Resources/lib/libOpenImageDenoise.dylib'
if not lib_path.exists():raise RuntimeError('This bake requires Blender bundled OpenImageDenoise: '+str(lib_path))
oidn=ctypes.CDLL(str(lib_path));ptr=ctypes.c_void_p
signatures={
 'oidnNewDevice':([ctypes.c_int],ptr),'oidnSetDeviceInt':([ptr,ctypes.c_char_p,ctypes.c_int],None),
 'oidnCommitDevice':([ptr],None),'oidnNewFilter':([ptr,ctypes.c_char_p],ptr),
 'oidnSetSharedFilterImage':([ptr,ctypes.c_char_p,ptr,ctypes.c_int]+[ctypes.c_size_t]*5,None),
 'oidnSetFilterBool':([ptr,ctypes.c_char_p,ctypes.c_bool],None),
 'oidnCommitFilter':([ptr],None),'oidnExecuteFilter':([ptr],None),
 'oidnGetDeviceError':([ptr,ctypes.POINTER(ctypes.c_char_p)],ctypes.c_int),
 'oidnReleaseFilter':([ptr],None),'oidnReleaseDevice':([ptr],None),
}
for name,(args,result) in signatures.items():
 function=getattr(oidn,name);function.argtypes=args;function.restype=result
device=oidn.oidnNewDevice(1);oidn.oidnSetDeviceInt(device,b'numThreads',4);oidn.oidnCommitDevice(device)
width,height=image.size;rgba=np.empty(width*height*4,dtype=np.float32);image.pixels.foreach_get(rgba)
rgba=rgba.reshape(height,width,4);color=np.ascontiguousarray(rgba[:,:,:3]);filtered=np.empty_like(color)
filter=oidn.oidnNewFilter(device,b'RT')
for name,values in [(b'color',color),(b'output',filtered)]:
 oidn.oidnSetSharedFilterImage(filter,name,values.ctypes.data,3,width,height,0,0,0)
oidn.oidnSetFilterBool(filter,b'hdr',True);oidn.oidnCommitFilter(filter);oidn.oidnExecuteFilter(filter)
message=ctypes.c_char_p();error=oidn.oidnGetDeviceError(device,ctypes.byref(message))
if error:raise RuntimeError('Denoising failed: '+str(message.value))
rgba[:,:,:3]=filtered;image.pixels.foreach_set(rgba.ravel());image.update()
oidn.oidnReleaseFilter(filter);oidn.oidnReleaseDevice(device)
print('DENOISE_COMPLETE',flush=True)
# Store raw RGBM irradiance. PlayCanvas decodes (8 * alpha * rgb)^2.
# Keep full-resolution source color textures separate; never denoise their grain.
linear=np.maximum(filtered,0);root_value=np.sqrt(np.minimum(linear,64))
multiplier=np.maximum(np.ceil(root_value.max(axis=2)/8*255)/255,1/255)
rgba[:,:,:3]=root_value/(8*multiplier[:,:,None]);rgba[:,:,3]=multiplier
encoded=bpy.data.images.new('Room irradiance RGBM',width=width,height=height,alpha=True,float_buffer=False)
encoded.colorspace_settings.name='Non-Color';encoded.pixels.foreach_set(rgba.ravel());encoded.update()
encoded.filepath_raw=str(root/'shared/rooms/cg-arch-interior/assets/lighting-rgbm.png');encoded.file_format='PNG';encoded.save()
print('IRRADIANCE_RANGE',float(linear.max()),'ENCODED_MAX',float(root_value.max()),flush=True)
# UV0 retains original material maps; UV1 holds the independent lighting atlas.
for layer in list(obj.data.uv_layers):
 if layer.name not in ('SourceUV','LightingAtlas'):obj.data.uv_layers.remove(layer)
assert [layer.name for layer in obj.data.uv_layers]==['SourceUV','LightingAtlas']
obj.data.uv_layers.active=obj.data.uv_layers['SourceUV'];obj.data.uv_layers.active.active_render=True
print('BAKE_COMPLETE',flush=True)
runpy.run_path(str(root/'scripts/prepare_cg_arch_room.py'),run_name='__main__')
