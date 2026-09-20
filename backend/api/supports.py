"""Reviewed horizontal supports; attachments are authoritative and poses are derived.

Only upright, one-level attachments are supported. Unknown models remain solid
catalogue boxes; reviewed hollow supports use individual panel collision boxes.
"""
import copy
import json
import math
from functools import lru_cache
from .shared_data import shared_root


def fail(code, message):
    from .scene_service import SceneError
    raise SceneError(code, message, details={'issues': [{'code': code, 'message': message}]})


@lru_cache(maxsize=4)
def profiles(path, modified):
    return json.loads(path.read_text())['profiles']


def profile_of(product):
    path = shared_root()/'placement-profiles.json'
    for p in profiles(path, path.stat().st_mtime_ns):
        if p['productId'] == product['productId'] and p['modelUrl'] == product.get('modelUrl') and all(abs(p[k]-product[k]) < 1e-6 for k in ('widthCm','depthCm','heightCm')):
            return p
    return None


def local_to_world(parent, local):
    c,s=math.cos(parent['yawRad']),math.sin(parent['yawRad'])
    return dict(xCm=parent['xCm']+c*local['xCm']+s*local['zCm'], zCm=parent['zCm']-s*local['xCm']+c*local['zCm'],
                yawRad=parent['yawRad']+local['yawRad'], yCm=parent.get('yCm',0)+local.get('yCm',0))


def world_to_local(parent, world):
    c,s=math.cos(parent['yawRad']),math.sin(parent['yawRad']); dx,dz=world['xCm']-parent['xCm'],world['zCm']-parent['zCm']
    return dict(xCm=c*dx-s*dz,zCm=s*dx+c*dz,yawRad=world['yawRad']-parent['yawRad'])


def attachment_target(a, instances, products):
    from .scene_service import valid_pose
    if (not isinstance(a,dict) or set(a)!={'parentInstanceId','target','localPose','profileRevision'} or
        not isinstance(a['parentInstanceId'],str) or not isinstance(a['profileRevision'],str) or
        not isinstance(a['target'],dict) or set(a['target'])!={'kind','id'} or a['target']['kind'] not in ('surface','compartment') or
        not isinstance(a['target']['id'],str) or not valid_pose(a['localPose']) or 'yCm' in a['localPose']):
        fail('invalid_attachment','Invalid support reference.')
    parent=next((i for i in instances if i['instanceId']==a['parentInstanceId']),None)
    if not parent or parent.get('attachment'): fail('unsupported_target','Choose a floor-standing support in this room.')
    profile=profile_of(products[parent['productId']])
    if not profile: fail('unsupported_target','This model has no reviewed support surfaces.')
    if a['profileRevision']!=profile['revision']: fail('stale_profile','The support geometry changed. Choose the surface again.')
    target=next((t for t in profile['targets'] if t['id']==a['target']['id'] and t['kind']==a['target']['kind']),None)
    if not target: fail('unsupported_target','The support surface is unavailable.')
    return parent,profile,target


def resolve_attachments(instances, products):
    result=copy.deepcopy(instances)
    for item in result:
        a=item.get('attachment')
        if a is None:
            if item['pose'].get('yCm',0)!=0: fail('unsupported_height','An elevated object needs a support.')
            continue
        parent,profile,target=attachment_target(a,result,products)
        if parent['instanceId']==item['instanceId']: fail('unsupported_target','An object cannot support itself.')
        item['pose']=local_to_world(parent['pose'],{**a['localPose'],'yCm':target['yCm']})
    return result


def support_fit(item, product, instances, products):
    if not item.get('attachment'): return
    _,_,target=attachment_target(item['attachment'],instances,products)
    p=item['attachment']['localPose'];c,s=abs(math.cos(p['yawRad'])),abs(math.sin(p['yawRad']))
    ex=(c*product['widthCm']+s*product['depthCm'])/2;ez=(s*product['widthCm']+c*product['depthCm'])/2
    if abs(p['xCm']-target['xCm'])+ex>target['widthCm']/2+1e-6 or abs(p['zCm']-target['zCm'])+ez>target['depthCm']/2+1e-6:
        fail('support_overhang','The whole object must fit on its support.')
    if target['kind']=='compartment' and product['heightCm']>target['heightCm']+1e-6:
        fail('outside_compartment','The object is too tall for this compartment.')


def solid_parts(item, product):
    profile=profile_of(product)
    solids=profile['solids'] if profile else [dict(xCm=0,yCm=0,zCm=0,widthCm=product['widthCm'],depthCm=product['depthCm'],heightCm=product['heightCm'])]
    return [{**b,**local_to_world(item['pose'],{**b,'yawRad':0})} for b in solids]


def collides(a, pa, b, pb):
    from .scene_service import overlaps,footprint
    if not a.get("attachment") and not b.get("attachment"):
        return overlaps(footprint(pa,a["pose"]),footprint(pb,b["pose"]))
    for aa in solid_parts(a,pa):
        for bb in solid_parts(b,pb):
            if aa['yCm']+aa['heightCm']<=bb['yCm']+1e-6 or bb['yCm']+bb['heightCm']<=aa['yCm']+1e-6: continue
            if overlaps(footprint(aa,aa),footprint(bb,bb)): return True
    return False


def move_attachment(target, pose, instances, products, explicit=False, attachment=None):
    if explicit:
        if attachment is None: target.pop('attachment',None)
        else: target['attachment']=attachment
    elif target.get('attachment'):
        parent,_,_=attachment_target(target['attachment'],instances,products)
        target['attachment']['localPose']=world_to_local(parent['pose'],pose)
    target['pose']=pose


def support_context(instances, products):
    result=[]
    for item in instances:
        if item.get('attachment'): continue
        p=profile_of(products[item['productId']])
        if p:
            for t in p['targets']:
                result.append({**t,'instanceId':item['instanceId'],'profileRevision':p['revision'],
                               'worldPose':local_to_world(item['pose'],{**t,'yawRad':0})})
    return result
