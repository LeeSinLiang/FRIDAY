import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
};
const root = new URL('../../shared/', import.meta.url);
const registry = JSON.parse(await readFile(new URL('placement-profiles.json', root), 'utf8'));
const fixtures = JSON.parse(await readFile(new URL('scene-fixtures.json', root), 'utf8'));
for (const product of fixtures.products.filter(p => p.productId.startsWith('support-demo-'))) {
  const group = new Group();
  const profile = registry.profiles.find(p => p.productId === product.productId);
  const material = new MeshStandardMaterial({ color: product.color, roughness: .65 });
  const add = (geometry, x, y, z) => { const mesh = new Mesh(geometry, material); mesh.position.set(x/100,y/100,z/100); group.add(mesh); };
  if (profile) for (const b of profile.solids) add(new BoxGeometry(b.widthCm/100,b.heightCm/100,b.depthCm/100),b.xCm,b.yCm+b.heightCm/2,b.zCm);
  else if (product.productId.endsWith('lamp')) {
    add(new CylinderGeometry(.07,.07,.02,32),0,1,0);
    add(new CylinderGeometry(.012,.012,.24,16),0,14,0);
    add(new CylinderGeometry(.06,.1,.12,32),0,29,0);
  } else add(new BoxGeometry(.24,.20,.20),0,10,0);
  const binary = Buffer.from(await new GLTFExporter().parseAsync(group,{binary:true}));
  const directory = new URL(`models/furniture/${product.productId}/`,root);
  await mkdir(directory,{recursive:true});
  await writeFile(new URL('model.glb',directory),binary);
  if (profile) profile.modelSha256 = createHash('sha256').update(binary).digest('hex');
  console.log(`${product.productId}: ${binary.length} bytes`);
}
await writeFile(new URL('placement-profiles.json',root),JSON.stringify(registry,null,2)+'\n');
