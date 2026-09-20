"""Current session references for both the shopping compiler and engine tools."""
import json
from urllib.parse import quote
from .shared_data import shared_root
from .supports import support_context


def scene_references(snapshot):
    room = snapshot['room']
    products = {p['productId']: p for p in snapshot['products']}
    items = snapshot['instances']
    supports = support_context(items, products)
    openings_path = shared_root()/'rooms'/room['roomId']/'openings.json'
    openings = json.loads(openings_path.read_text()).get('openings', []) if openings_path.exists() else []
    refs = {
        'roomId': room['roomId'], 'sceneRevision': snapshot['revision'],
        'geometryRevision': snapshot.get('geometryRevision'), 'units': 'cm',
        'building': room.get('scan', {}).get('building'),
        'walls': [{'id': 'w-'+side, 'label': label+' wall'} for side,label in [('n','north'),('e','east'),('s','south'),('w','west')]],
        'windows': [{'id': o['id'], 'wall_id': 'w-'+o['wall']} for o in openings if o['kind']=='window'],
        'doors': [{'id': o['id'], 'wall_id': 'w-'+o['wall']} for o in openings if o['kind']=='door'],
        'instances': [{'id': i['instanceId'], 'label': products[i['productId']]['name'], 'pose': i['pose']} for i in items],
        'surfaces': [], 'compartments': [],
    }
    labels = {i['id']: i['label'] for i in refs['instances']}
    for target in supports:
        ref = {**target, 'id': quote(target['instanceId'],safe='')+'/'+quote(target['id'],safe=''),
               'targetId': target['id'], 'label': labels[target['instanceId']]+' / '+target['label']}
        refs['surfaces' if target['kind']=='surface' else 'compartments'].append(ref)
    return refs
