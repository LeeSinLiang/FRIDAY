import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PRODUCTS, ROOM } from './fixtures';
import { validatePlacement } from './placement';
import { resolveAttachments, moveWithAttachments, supportReferenceId } from './supports';
import { furnitureHit } from './playcanvas/interaction';
import { pickSupport } from './playcanvas/supportPicking';
import { solve } from '../region/solve';
import type { Instance } from './types';

const table:Instance={instanceId:'table',productId:'support-demo-table',pose:{xCm:160,zCm:180,yawRad:0}};
const cabinet:Instance={instanceId:'cabinet',productId:'support-demo-cabinet',pose:{xCm:360,zCm:180,yawRad:0}};
const child=(id:string,parent=table,target='top',kind:'surface'|'compartment'='surface',x=0,z=0):Instance=>({
 instanceId:id,productId:'support-demo-box',pose:{xCm:0,zCm:0,yawRad:0},
 attachment:{parentInstanceId:parent.instanceId,profileRevision:'1',target:{kind,id:target},localPose:{xCm:x,zCm:z,yawRad:0}}
});
const product=(i:Instance)=>PRODUCTS.find(p=>p.productId===i.productId)!;

test('supported positions use measured height, full-footprint support and independent shelf layers',()=>{
 const instances=resolveAttachments([cabinet,child('lower',cabinet,'lower','compartment',0,2),child('middle',cabinet,'upper','compartment',0,2)],PRODUCTS);
 assert.equal(instances[1].pose.yCm,3);assert.equal(instances[2].pose.yCm,51.5);
 for(const item of instances) assert.equal(validatePlacement(ROOM,PRODUCTS,instances,item.instanceId,item.pose).valid,true);
 const outside={...instances[2].pose,xCm:400};
 assert.equal(validatePlacement(ROOM,PRODUCTS,instances,'middle',outside).valid,false);
 const overlap=resolveAttachments([...instances,child('duplicate',cabinet,'upper','compartment',0,2)],PRODUCTS);
 assert.equal(validatePlacement(ROOM,PRODUCTS,overlap,'duplicate',overlap[3].pose).valid,false);
});

test('parent translation and rotation preserve local attachment while a bad child move is rejected',()=>{
 const instances=resolveAttachments([table,child('box',table,'top','surface',25,0)],PRODUCTS);
 const moved=moveWithAttachments(instances,PRODUCTS,'table',{xCm:300,zCm:250,yawRad:Math.PI/2});
 assert.equal(moved[1].pose.xCm,300);assert.equal(moved[1].pose.zCm,225);assert.equal(moved[1].pose.yCm,75);
 assert.equal(validatePlacement(ROOM,PRODUCTS,moved,'box',{...moved[1].pose,zCm:100}).valid,false);
});

test('selection ray reaches the middle object through the cabinet opening, but hits a side panel beside it',()=>{
 const [parent,box]=resolveAttachments([cabinet,child('middle',cabinet,'upper','compartment',-18,2)],PRODUCTS);
 const ray={origin:{x:342,y:61.5,z:400},direction:{x:0,y:0,z:-1}};
 const boxHit=furnitureHit(ray,box,product(box))!,cabinetHit=furnitureHit(ray,parent,product(parent))!;
 assert.ok(boxHit.distance<cabinetHit.distance,'object inside must win over back panel');
 const sideRay={...ray,origin:{...ray.origin,x:408}};
 assert.equal(furnitureHit(sideRay,box,product(box)),null);
 assert.ok(furnitureHit(sideRay,parent,product(parent)),'visible side panel selects cabinet');
 const rotated=moveWithAttachments([parent,box],PRODUCTS,'cabinet',{xCm:360,zCm:180,yawRad:Math.PI/2});
 const rotatedRay={origin:{x:550,y:61.5,z:198},direction:{x:-1,y:0,z:0}};
 assert.ok(furnitureHit(rotatedRay,rotated[1],product(box))!.distance<furnitureHit(rotatedRay,rotated[0],product(parent))!.distance);
});

test('pointer can insert an off-centre object into the middle compartment without picking the top',()=>{
 // Ray enters the front opening at Y 60cm; the top is above the ray.
 const ray={origin:{x:342,y:76.5,z:232},direction:{x:0,y:-.4472135955,z:-.894427191}};
 const picked=pickSupport(ray,[cabinet],PRODUCTS,0,true)!;
 assert.equal(picked.attachment?.target.id,'upper');assert.equal(picked.pose.yCm,51.5);
 const box={...child('box'),pose:picked.pose,attachment:picked.attachment};
 assert.equal(validatePlacement(ROOM,PRODUCTS,[cabinet,box],'box',box.pose,box.attachment).valid,true);
});

test('on and inside masks use the support height and cannot silently fall back to the floor',()=>{
 const scene={room:ROOM,products:PRODUCTS,instances:[cabinet,table]},candidate={product:product(child('box'))};
 const solution=solve(scene,candidate,[{k:'inside',ref:{kind:'compartment',id:supportReferenceId('cabinet','upper')}}]);
 assert.ok(solution.legalCounts[0]>0);assert.equal(solution.masks[0].heightCm,51.5);
 assert.equal(solution.masks[0].attachment?.parentInstanceId,'cabinet');
 const missing=solve(scene,candidate,[{k:'on',ref:{kind:'surface',id:'missing/top'}}]);
 assert.equal(missing.bestYawIndex,-1);
 assert.match(missing.whyNothingFits!,/unavailable/);
});

// This bridge used to drop the third argument despite geometry tests passing.
test('the mounted renderer forwards support references for both insert and move', async()=>{
 const source=await readFile(new URL('PlayCanvasScene.tsx',`file://${process.cwd()}/src/`),'utf8');
 for(const callback of ['onPlace','onCommit'])
  assert.ok(source.includes(`${callback}:(id,pose,attachment)=>latest.current.callbacks.${callback}(id,pose,attachment)`));
});
