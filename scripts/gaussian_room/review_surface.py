"""Review the known Haussmann 5 cm shell; run from the repository root after preparation."""
import json,struct,math
from pathlib import Path
b=Path('shared/rooms/haussmann-apartment/assets/surface-full-167fbe4c9837.collision.glb').read_bytes();n=struct.unpack_from('<I',b,12)[0];d=json.loads(b[20:20+n]);raw=b[28+n:]
a=d['accessors'][0];v=d['bufferViews'][a['bufferView']];start=v.get('byteOffset',0);verts=list(struct.iter_unpack('<3f',raw[start:start+a['count']*12]))
a=d['accessors'][1];v=d['bufferViews'][a['bufferView']];start=v.get('byteOffset',0);inds=struct.unpack_from('<%dI'%a['count'],raw,start)
floor=set();blocked=set()
for i in range(0,len(inds),3):
 t=[verts[j] for j in inds[i:i+3]]; ys=[p[1] for p in t];lo=min(ys);hi=max(ys)
 isfloor=abs(hi-lo)<.001 and -.1<=lo<=.1
 isbody=hi>.15 and lo<2.5
 if not isfloor and not isbody:continue
 xs=[p[0]-1.4 for p in t];zs=[p[2]+1.45 for p in t]
 x0=math.floor((min(xs)+.001)/.05);x1=max(x0+1,math.ceil((max(xs)-.001)/.05))
 z0=math.floor((min(zs)+.001)/.05);z1=max(z0+1,math.ceil((max(zs)-.001)/.05))
 for x in range(x0,x1):
  for z in range(z0,z1):
   if isfloor:floor.add((x,z))
   if isbody:blocked.add((x,z))
# 20cm coarse ASCII summary over the proposed interior, rejecting any occupied 5cm cell.
for z in range(0,188,4):
 print(''.join('X' if any((x+dx,z+dz) in blocked for dx in range(4) for dz in range(4)) else '.' if all((x+dx,z+dz) in floor for dx in range(4) for dz in range(4)) else '?' for x in range(0,132,4)))
for rect in [(40,480,60,870),(75,450,100,800),(100,400,200,700)]:
 x0,x1,z0,z1=[round(v/5) for v in rect];cells={(x,z) for x in range(x0,x1) for z in range(z0,z1)};print(rect,'cells',len(cells),'unsupported',len(cells-floor),'blocked',len(cells&blocked))
Path('.scratch/gaussian/surface-grid.json').write_text(json.dumps({'floor':sorted(floor),'blocked':sorted(blocked)}))

spatial=json.loads(Path('shared/rooms/haussmann-apartment/spatial.json').read_text())
for area in spatial['freeAreas']:
 cells={(x,z) for x in range(round(area['minXcm']/5),round(area['maxXcm']/5)) for z in range(round(area['minZcm']/5),round(area['maxZcm']/5))}
 assert cells <= floor, 'Reviewed area contains unsupported cells'
 assert not cells & blocked, 'Reviewed area intersects body geometry'
print('Committed freeAreas all pass sampled surface support and body exclusion.')
