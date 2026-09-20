"""Export the selected Cg Arch room from Blender; run with --background --factory-startup --disable-autoexec source.blend --python this_script.py.
The downloaded .blend and converted binaries stay local. See the indexed Cg Arch room documentation.
"""
import bpy, json, math, pathlib, struct, numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
root=pathlib.Path(__file__).resolve().parent.parent / 'shared' / 'rooms' / 'cg-arch-interior'
(root/'assets').mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
# glTF cannot represent the source wall/floor Hue/Saturation nodes. Bake their
# exact neutral-hue albedo operations in texture space at original resolution.
color_cache={}
for material in bpy.data.materials:
 if not material.use_nodes:continue
 for node in list(material.node_tree.nodes):
  if node.type!='BSDF_PRINCIPLED' or not node.inputs['Base Color'].is_linked:continue
  adjustment=node.inputs['Base Color'].links[0].from_node
  if adjustment.type!='HUE_SAT' or adjustment.inputs['Hue'].default_value!=.5 or adjustment.inputs['Factor'].default_value!=1:continue
  if not adjustment.inputs['Color'].is_linked:continue
  source_node=adjustment.inputs['Color'].links[0].from_node
  if source_node.type!='TEX_IMAGE' or not source_node.image:continue
  source=source_node.image;value=adjustment.inputs['Value'].default_value;saturation=adjustment.inputs['Saturation'].default_value;key=(source.name,saturation,value)
  if key not in color_cache:
   width,height=source.size;pixels=np.empty(width*height*4,np.float32);source.pixels.foreach_get(pixels);pixels=pixels.reshape(-1,4)
   # Byte-image pixel buffers retain sRGB encoding; shader color inputs are linear.
   if source.colorspace_settings.name=='sRGB' and not source.is_float:
    rgb=pixels[:,:3];pixels[:,:3]=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
   maximum=pixels[:,:3].max(axis=1)[:,None]
   pixels[:,:3]=np.clip((maximum+(pixels[:,:3]-maximum)*saturation)*value,0,1)
   image=bpy.data.images.new('Prepared source albedo',width=width,height=height,alpha=True,float_buffer=True)
   image.pixels.foreach_set(pixels.ravel());image.update()
   filepath=root/'assets'/('material-color-'+str(len(color_cache))+'.png')
   old=(scene.view_settings.view_transform,scene.view_settings.look,scene.view_settings.exposure,scene.view_settings.gamma)
   scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
   scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
   image.save_render(str(filepath),scene=scene)
   scene.view_settings.view_transform=old[0];scene.view_settings.look=old[1];scene.view_settings.exposure=old[2];scene.view_settings.gamma=old[3]
   prepared=bpy.data.images.load(str(filepath),check_existing=False);prepared.pack();color_cache[key]=prepared
   print('PREPARED_ALBEDO',source.name,width,height,float(pixels[:,:3].mean()),flush=True)
  source_node.image=color_cache[key]
  material.node_tree.links.new(source_node.outputs['Color'],node.inputs['Base Color'])
deps=bpy.context.evaluated_depsgraph_get()
origin=Vector((-12.518789291381836,9.593236923217773,0))
meshes=[]; verts=[]; faces=[]; total=0
white=bpy.data.materials.new('Architectural white fallback')
white.use_nodes=True
white.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(0.8,0.8,0.8,1)
white.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=0
white.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.65
for o in list(scene.objects):
 if o.type!='MESH' or o.hide_render or o.name=='archicadobjects': continue
 evaluated=o.evaluated_get(deps)
 m=bpy.data.meshes.new_from_object(evaluated,depsgraph=deps)
 # Blender renders unassigned faces white. glTF's implicit material is metallic;
 # supply the source appearance explicitly instead of exporting missing materials.
 if not m.materials: m.materials.append(white)
 for i,slot in enumerate(o.material_slots):
  if i<len(m.materials):m.materials[i]=slot.material or white
 m.transform(o.matrix_world)
 if not m.vertices or min(v.co.x for v in m.vertices)>1 or max(v.co.x for v in m.vertices)<-13:
  bpy.data.meshes.remove(m);continue
 offset=len(verts)
 verts.extend([v.co.copy() for v in m.vertices]);faces.extend([tuple(offset+i for i in p.vertices) for p in m.polygons])
 m.transform(Matrix.Translation(-origin))
 item=bpy.data.objects.new('Room '+o.name,m);meshes.append(item);total+=len(m.polygons)
# Verify conservative living-room zone has floor support and clear body volume.
bvh=BVHTree.FromPolygons(verts,faces)
errors=[]
for ix in range(67):
 for iy in range(117):
  x=origin.x+(787+ix*5)/100;y=origin.y-(180+iy*5)/100
  hit=bvh.ray_cast(Vector((x,y,2.4)),Vector((0,0,-1)),2.5)
  if hit[0] is None or abs(hit[0].z)>.025:errors.append([round(x,2),round(y,2),round(hit[0].z,3) if hit[0] else None])
print('ZONE_OBSTRUCTIONS',len(errors),errors[:12],flush=True)
if errors: raise RuntimeError('The configured placement zone is no longer clear; review the source mesh before exporting.')
# Keep all original data in the downloaded source; export evaluated mesh copies only.
for o in list(scene.objects): bpy.data.objects.remove(o,do_unlink=True)
for o in meshes:scene.collection.objects.link(o)
for m in bpy.data.materials:
 if m.use_nodes:
  # Missing author-local images cannot be exported. Preserve authored scalar values.
  for n in list(m.node_tree.nodes):
   if n.type=='TEX_IMAGE' and n.image and not n.image.packed_file and n.image.size[0] == 0: m.node_tree.nodes.remove(n)
# The lighting rig remains renderer-owned; area lights and Cycles world do not export to glTF.
bpy.ops.export_scene.gltf(filepath=str(root/'assets/room-export.glb'),export_format='GLB',export_cameras=False,export_lights=False,export_animations=False,export_apply=True,export_yup=True,export_extras=True)
# Standard glTF has no lightmap slot. Carry RGBM irradiance in occlusionTexture;
# explicit material extras tell our PlayCanvas loader to move it to lightMap.
asset=root/'assets/room.glb'
data=(root/'assets/room-export.glb').read_bytes();json_size=struct.unpack_from('<I',data,12)[0]
doc=json.loads(data[20:20+json_size]);binary=data[28+json_size:];baked_indices=[]
doc['asset'].setdefault('extras',{})['fridayColorManagement']={'viewTransform':scene.view_settings.view_transform,'look':scene.view_settings.look,'exposureEV':scene.view_settings.exposure,'exposureScale':2**scene.view_settings.exposure,'gamma':scene.view_settings.gamma}
lightmap=root/'assets/lighting-rgbm.png'
marked=any(m.get('extras',{}).get('fridayBakedLighting') for m in doc.get('materials',[]))
if marked:
 image_data=lightmap.read_bytes();offset=len(binary);binary+=image_data;binary+=b'\0'*((-len(binary))%4)
 view_index=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(image_data)})
 image_index=len(doc.setdefault('images',[]));doc['images'].append({'bufferView':view_index,'mimeType':'image/png','name':'Room irradiance RGBM'})
 texture_index=len(doc.setdefault('textures',[]));doc['textures'].append({'source':image_index})
 doc['buffers'][0]['byteLength']=len(binary)
for i,material in enumerate(doc.get('materials',[])):
 if material.get('name','').split('|')[-1].strip().lower().startswith('glass'):
  material['pbrMetallicRoughness']={'baseColorFactor':[1,1,1,0.06],'metallicFactor':0,'roughnessFactor':0.08}
  material['alphaMode']='BLEND'
  material.get('extras',{}).pop('fridayBakedLighting',None)
 if material.get('extensions',{}).get('KHR_materials_transmission',{}).get('transmissionFactor',0)>0:
  material.get('extras',{}).pop('fridayBakedLighting',None)
 if material.get('extras',{}).get('fridayBakedLighting'):
  material['occlusionTexture']={'index':texture_index,'texCoord':1,'strength':0}
  baked_indices.append(i)
for mesh in doc.get('meshes',[]):
 for primitive in mesh['primitives']:
  if primitive.get('material') in baked_indices:
   assert 'TEXCOORD_0' in primitive['attributes'] and 'TEXCOORD_1' in primitive['attributes'], 'Lightmapped geometry must export source UV0 and lighting UV1'
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
tail=struct.pack('<II',len(binary),0x004e4942)+binary;size=20+len(encoded)+len(tail)
temporary=asset.with_suffix('.glb.tmp')
temporary.write_bytes(struct.pack('<III',0x46546c67,2,size)+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+tail)
temporary.replace(asset)
print('EXPORTED',total,asset.stat().st_size,'BAKED_MATERIALS',baked_indices,flush=True)
(root/'assets/inspection.json').write_text(json.dumps({'sourceOriginBlenderMeters':list(origin),'meshPolygons':total,'clearZoneObstructions':errors,'lighting':'rgbm_irradiance_uv1' if baked_indices else 'runtime'},indent=2))
