import copy
import hashlib
import json
import math
import struct
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from django.test import TestCase
from .scene_service import SceneError, validate_instances, apply_scene_commands, serialize, scene_for_session
from .engine_tools import try_place, get_scene_context
from catalogue.dsl.schema import Program
from catalogue.dsl.compile import check_refs


def item(identifier, product, x=200, z=200, yaw=0):
    return {'instanceId':identifier,'productId':'support-demo-'+product,'pose':{'xCm':x,'zCm':z,'yawRad':yaw}}


def attached(identifier='lamp', product='lamp', parent='table', target='top', kind='surface', x=0, z=0):
    return {**item(identifier,product),'attachment':{'parentInstanceId':parent,'profileRevision':'1',
        'target':{'kind':kind,'id':target},'localPose':{'xCm':x,'zCm':z,'yawRad':0}}}


class SupportedPlacementTests(TestCase):
    def test_table_contact_and_untrusted_height_is_derived(self):
        lamp=attached();lamp['pose']['yCm']=999
        result=validate_instances([item('table','table'),lamp])
        self.assertEqual(result[1]['pose'],{'xCm':200,'zCm':200,'yawRad':0,'yCm':75})
        lamp['attachment']['localPose']['xCm']=51
        with self.assertRaisesMessage(SceneError,'whole object'): validate_instances([item('table','table'),lamp])

    def test_two_shelves_same_xz_are_valid_but_same_shelf_overlap_is_not(self):
        cabinet=item('cabinet','cabinet')
        a=attached('lower-box','box','cabinet','lower','compartment',z=2)
        b=attached('middle-box','box','cabinet','upper','compartment',z=2)
        result=validate_instances([cabinet,a,b])
        self.assertEqual([i['pose'].get('yCm',0) for i in result],[0,3,51.5])
        b['attachment']['target']['id']='lower'
        with self.assertRaisesMessage(SceneError,'Overlaps'): validate_instances([cabinet,a,b])

    def test_compartment_height_edges_and_side_panel_are_not_ignored(self):
        cabinet=item('cabinet','cabinet');box=attached('box','box','cabinet','upper','compartment',z=2)
        box['attachment']['localPose']['xCm']=40
        with self.assertRaisesMessage(SceneError,'whole object'): validate_instances([cabinet,box])
        box=attached('table','table','cabinet','upper','compartment')
        with self.assertRaises(SceneError): validate_instances([cabinet,box])

    def test_unknown_stale_nested_and_unsupported_height_are_rejected(self):
        for patcher in [lambda a:a.update(parentInstanceId='missing'),lambda a:a.update(profileRevision='old'),lambda a:a['target'].update(id='missing')]:
            lamp=attached();patcher(lamp['attachment'])
            with self.assertRaises(SceneError): validate_instances([item('table','table'),lamp])
        lamp=item('lamp','lamp');lamp['pose']['yCm']=50
        with self.assertRaisesMessage(SceneError,'support'): validate_instances([lamp])
        table=attached('table','table','cabinet');lamp=attached()
        with self.assertRaises(SceneError): validate_instances([item('cabinet','cabinet'),table,lamp])

    def test_parent_move_rotation_atomic_rejection_and_delete_guard(self):
        scene=apply_scene_commands('support-session',0,'seed',[{'type':'add','instance':item('table','table')},{'type':'add','instance':attached(x=25)}])
        scene=apply_scene_commands('support-session',scene['revision'],'move',[{'type':'setPose','instanceId':'table','pose':{'xCm':300,'zCm':250,'yawRad':math.pi/2}}])
        lamp=scene['instances'][1]
        self.assertAlmostEqual(lamp['pose']['xCm'],300);self.assertAlmostEqual(lamp['pose']['zCm'],225)
        self.assertEqual(lamp['pose']['yCm'],75)
        before=copy.deepcopy(scene['instances'])
        with self.assertRaises(SceneError): apply_scene_commands('support-session',scene['revision'],'bad',[{'type':'setPose','instanceId':'table','pose':{'xCm':10,'zCm':10,'yawRad':0}}])
        self.assertEqual(serialize(scene_for_session('support-session'))['instances'],before)
        with self.assertRaisesMessage(SceneError,'supported items'): apply_scene_commands('support-session',scene['revision'],'delete',[{'type':'remove','instanceId':'table'}])

    def test_agent_context_dry_run_and_retry_use_real_targets(self):
        apply_scene_commands('tools',0,'seed',[{'type':'add','instance':item('table','table')}])
        context=get_scene_context('tools')
        self.assertEqual(context['references']['surfaces'][0]['id'],'table/top')
        self.assertEqual(get_scene_context('other')['references']['surfaces'],[])
        preview=try_place('tools',attached(),1,'lamp',dry_run=True)
        self.assertTrue(preview['ok'],preview);self.assertEqual(preview['resolvedInstance']['pose']['yCm'],75)
        self.assertEqual(preview['revision'],1)
        saved=try_place('tools',attached(),1,'lamp');self.assertTrue(saved['ok'],saved)
        self.assertEqual(saved,try_place('tools',attached(),1,'lamp'))
        self.assertEqual(saved['instances'][1]['attachment']['target']['id'],'top')

    def test_compiler_uses_session_refs_and_rejects_stale_context(self):
        self.client.get('/api/scene/?roomId=demo-room')
        from shopping.models import ShoppingSession
        from shopping.identity import digest
        key=ShoppingSession.objects.get(token_hash=digest(self.client.cookies['friday_shopping'].value)).scene_key
        apply_scene_commands(key,0,'seed',[{'type':'add','instance':item('cabinet','cabinet')}])
        program=Program.model_validate({'find':[{'k':'category','value':'decor'}], 'place':[{'k':'inside','ref':{'kind':'compartment','id':'cabinet/upper'}}]})
        def compile(text, refs, *_):
            self.assertEqual(refs['roomId'],'demo-room');check_refs(program,refs)
            self.assertEqual({t['id'] for t in refs['compartments']},{'cabinet/lower','cabinet/upper'})
            return SimpleNamespace(program=program,source='model',ms=0)
        with patch('catalogue.views.compile_text',side_effect=compile):
            response=self.client.post('/api/compile',{'text':'put a box inside the cabinet upper shelf','roomId':'demo-room','sceneRevision':1},content_type='application/json')
        self.assertEqual(response.status_code,200,response.content)
        self.assertEqual(response.json()['sceneRevision'],1)
        stale=self.client.post('/api/compile',{'text':'a lamp','roomId':'demo-room','sceneRevision':0},content_type='application/json')
        self.assertEqual(stale.status_code,409)

    def test_profile_hash_matches_actual_glb_and_has_middle_support(self):
        root=Path(__file__).resolve().parents[2]/'shared'
        for p in json.loads((root/'placement-profiles.json').read_text())['profiles']:
            binary=(root/p['modelUrl'].lstrip('/')).read_bytes()
            self.assertEqual(hashlib.sha256(binary).hexdigest(),p['modelSha256'])
            self.assertEqual(binary[:4],b'glTF')
        cabinet=json.loads((root/'placement-profiles.json').read_text())['profiles'][1]
        self.assertTrue(any(0<t['yCm']<cabinet['heightCm'] for t in cabinet['targets'] if t['kind']=='compartment'))

    def test_agent_malformed_existing_item_is_a_validation_error(self):
        apply_scene_commands('malformed',0,'seed',[{'type':'add','instance':item('table','table')}])
        result=try_place('malformed',{'instanceId':'table','pose':{'xCm':200,'zCm':200,'yawRad':0}},1,'bad')
        self.assertFalse(result['ok']);self.assertEqual(result['error']['code'],'validation')

    def test_authored_glb_panel_bounds_match_selection_and_collision_profiles(self):
        root=Path(__file__).resolve().parents[2]/'shared'
        for profile in json.loads((root/'placement-profiles.json').read_text())['profiles']:
            # These fixtures are generated one mesh per solid. Imported PC models
            # use conservative proxies and have separate world-geometry checks.
            if not profile['productId'].startswith('support-demo-'):
                continue
            binary=(root/profile['modelUrl'].lstrip('/')).read_bytes()
            length=struct.unpack_from('<I',binary,12)[0]
            gltf=json.loads(binary[20:20+length])
            nodes=[n for n in gltf['nodes'] if 'mesh' in n]
            self.assertEqual(len(nodes),len(profile['solids']))
            for node,solid in zip(nodes,profile['solids']):
                accessor=gltf['accessors'][gltf['meshes'][node['mesh']]['primitives'][0]['attributes']['POSITION']]
                expected_min=[solid['xCm']-solid['widthCm']/2,solid['yCm'],solid['zCm']-solid['depthCm']/2]
                expected_max=[solid['xCm']+solid['widthCm']/2,solid['yCm']+solid['heightCm'],solid['zCm']+solid['depthCm']/2]
                # Exporter stores an identity rotation/scale and translation matrix.
                matrix=node.get('matrix',[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])
                for axis in range(3):
                    self.assertAlmostEqual((accessor['min'][axis]+matrix[12+axis])*100,expected_min[axis],places=4)
                    self.assertAlmostEqual((accessor['max'][axis]+matrix[12+axis])*100,expected_max[axis],places=4)

    def test_compile_keeps_stable_guest_and_claimed_scene_after_session_rotation(self):
        from django.contrib.auth import get_user_model
        from shopping.models import ShoppingSession
        from shopping.identity import digest
        self.client.get('/api/scene/?roomId=demo-room')
        shopping=ShoppingSession.objects.get(token_hash=digest(self.client.cookies['friday_shopping'].value))
        apply_scene_commands(shopping.scene_key,0,'seed',[{'type':'add','instance':item('table','table')}])
        session=self.client.session;session.cycle_key();session.save()
        self.client.cookies['sessionid']=session.session_key
        program=Program.model_validate({'find':[{'k':'category','value':'lamp'}], 'place':[{'k':'on','ref':{'kind':'surface','id':'table/top'}}]})
        def compile(text,refs,*_):
            self.assertEqual(refs['surfaces'][0]['id'],'table/top')
            return SimpleNamespace(program=program,source='model',ms=0)
        with patch('catalogue.views.compile_text',side_effect=compile):
            response=self.client.post('/api/compile',{'text':'lamp on the table','roomId':'demo-room','sceneRevision':1},content_type='application/json')
            self.assertEqual(response.status_code,200,response.content)
            user=get_user_model().objects.create_user(username='support-owner')
            shopping.owner=user;shopping.save(update_fields=['owner'])
            self.client.force_login(user)
            response=self.client.post('/api/compile',{'text':'lamp on the table','roomId':'demo-room','sceneRevision':1},content_type='application/json')
            self.assertEqual(response.status_code,200,response.content)
