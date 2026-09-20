"""Real Haussmann geometry with small synthetic catalogue fixtures; no paid provider calls."""
import copy
import os
import uuid
from unittest.mock import patch

from django.test import Client, SimpleTestCase, TestCase
from accounts.tests import AccountTestCase
from catalogue.types import Listing
from . import designer_variants as variants
from . import designer_refinement
from .designer_agent import PlanReply
from .catalogue_products import catalogue_product
from .designer_jobs import active_request
from .models import SceneDesignJob
from .scene_service import SceneError, scene_for_session, validate_instances


def listing(key, category, cost, size, title=None):
    return Listing(id=key, source='stub', title=title or key, category=category, price_cents=cost,
                   dims_mm=dict(zip(('w', 'd', 'h'), size)), model_url='/models/test.glb',
                   thumb_url='/models/test.png', colour_hex=['#c9a77c'], materials=['oak'])


CATALOGUE = [listing('demo-oak-platform-bed', 'bed', 39900, (1720, 1882, 849)),
    listing('demo-cream-sofa', 'sofa', 29900, (1702, 965, 889)),
    listing('demo-brown-sofa', 'sofa', 29900, (1930, 870, 830)),
    listing('demo-nightstand', 'storage', 5900, (450, 400, 500)),
    listing('demo-floor-lamp', 'lamp', 7900, (400, 400, 1600)),
    listing('demo-pouf', 'armchair', 6900, (500, 500, 400)),
    listing('demo-bookcase', 'shelf', 12900, (800, 300, 1500)),
    listing('demo-dresser', 'storage', 17900, (1000, 400, 800))]


def brown_plan(state, text):
    """Provider stub only: spatial/catalogue/budget validation still runs for real."""
    sofa = next(i for i in state.instances if state.available[i['productId']].category == 'sofa')
    product = next(p for p in state.available.values() if p.category == 'sofa' and 'brown' in p.id)
    state.replace(sofa['instanceId'], product.id)
    return PlanReply(apply=True, message='Replaced the couch with the brown catalogue model.')


class BedroomVariantTests(TestCase):
    def setUp(self):
        self.session, self.room = 'variant-owner', 'haussmann-apartment'
        for mock in (patch('api.designer_variants.load_catalogue', return_value=CATALOGUE),
                     patch('api.catalogue_products._listings_by_id', return_value={p.id:p for p in CATALOGUE}),
                     patch('api.designer_refinement.plan', side_effect=brown_plan),
                     patch.dict(os.environ, {'OPENAI_API_KEY': ''})):
            mock.start()
            self.addCleanup(mock.stop)
        self.payload = {'text': 'I have a $1200 budget. Design me a warm bedroom. I want a couch beside the bed.',
                        'requestId': str(uuid.uuid4()), 'baseRevision': 0}

    def complete(self):
        result = variants.begin(self.session, self.room, self.payload)
        self.job_id = result['jobId']
        for _ in range(4):
            result = variants.poll(self.session, self.room, self.job_id)
        self.assertEqual(result['status'], 'completed', result)
        return result['variantSet']

    def test_three_complete_budgeted_real_geometry_drafts_do_not_save_scene(self):
        result = self.complete()
        self.assertEqual(len(result['variants']), 3)
        self.assertEqual(result['source'], 'validated_fallback')
        self.assertEqual(len({v['id'] for v in result['variants']}), 3)
        poses = []
        for variant in result['variants']:
            self.assertEqual(len(variant['instances']), 5)
            self.assertLessEqual(variant['totalCents'], 120000)
            validate_instances(variant['instances'], self.room)
            poses.append(variant['instances'][0]['pose'])
            bed, sofa = variant['instances'][:2]
            # Same Z coordinate or X coordinate means the couch is edge-adjacent,
            # not a disconnected furniture cluster somewhere else in the apartment.
            self.assertTrue(bed['pose']['zCm'] == sofa['pose']['zCm'] or bed['pose']['xCm'] == sofa['pose']['xCm'])
        self.assertEqual(len({str(p) for p in poses}), 3)
        saved = scene_for_session(self.session, self.room)
        self.assertEqual((saved.revision, saved.instances), (0, []))

    def test_brown_replacement_preserves_other_objects_and_both_siblings(self):
        result = self.complete()
        before = copy.deepcopy(result)
        active = result['variants'][0]
        payload = {'variantId':active['id'], 'baseRevision':0, 'requestId':str(uuid.uuid4()),
                   'text':'Actually, change the couch to a more brownish color.'}
        after = variants.refine(self.session, self.room, self.job_id, payload)['variantSet']
        self.assertEqual(after['variants'][1:], before['variants'][1:])
        self.assertEqual(after['variants'][0]['instances'][0], before['variants'][0]['instances'][0])
        self.assertEqual(after['variants'][0]['instances'][2:], before['variants'][0]['instances'][2:])
        new_sofa, old_sofa = after['variants'][0]['instances'][1], before['variants'][0]['instances'][1]
        self.assertEqual(new_sofa['pose'], old_sofa['pose'])
        self.assertEqual(new_sofa['instanceId'], old_sofa['instanceId'])
        self.assertEqual(new_sofa['productId'], 'demo-brown-sofa')
        self.assertEqual(after['variants'][0]['revision'], 1)
        self.assertEqual(variants.refine(self.session, self.room, self.job_id, payload)['variantSet'], after)
        with self.assertRaises(SceneError) as error:
            variants.refine(self.session, self.room, self.job_id, {**payload,'requestId':str(uuid.uuid4())})
        self.assertEqual(error.exception.code, 'revision_conflict')

    def test_natural_paraphrase_is_sent_verbatim_without_a_keyword_gate(self):
        draft = self.complete()
        payload = {'variantId': draft['variants'][0]['id'], 'baseRevision': 0,
                   'requestId': str(uuid.uuid4()), 'text': 'Could the seating feel more earthy and chocolate toned?'}
        with patch('api.designer_refinement.plan', side_effect=brown_plan) as planner:
            result = variants.refine(self.session, self.room, self.job_id, payload)
        self.assertEqual(planner.call_args.args[1], payload['text'])
        self.assertFalse(result['clarification'])
        self.assertEqual(result['variantSet']['variants'][0]['revision'], 1)

    def test_clarification_discards_staged_changes_and_replays_without_replanning(self):
        draft = self.complete()
        payload = {'variantId': draft['variants'][0]['id'], 'baseRevision': 0,
                   'requestId': str(uuid.uuid4()), 'text': 'Put the styroom in the corner.'}
        def clarify(state, text):
            brown_plan(state, text)
            return PlanReply(apply=False, message='Which furniture item do you mean by styroom?')
        with patch('api.designer_refinement.plan', side_effect=clarify) as planner:
            result = variants.refine(self.session, self.room, self.job_id, payload)
            replay = variants.refine(self.session, self.room, self.job_id, payload)
        self.assertEqual(planner.call_count, 1)
        self.assertTrue(result['clarification'])
        self.assertEqual(result, replay)
        self.assertEqual(result['variantSet'], draft)
        self.assertEqual(scene_for_session(self.session, self.room).instances, [])

    def test_concurrent_draft_edit_is_not_overwritten_after_provider_returns(self):
        draft = self.complete()
        payload = {'variantId': draft['variants'][0]['id'], 'baseRevision': 0,
                   'requestId': str(uuid.uuid4()), 'text': 'Change the couch.'}
        def changed_during_call(state, text):
            job = SceneDesignJob.objects.get(pk=self.job_id)
            job.data['variantSet']['variants'][0]['revision'] += 1
            job.save(update_fields=['data'])
            return brown_plan(state, text)
        with patch('api.designer_refinement.plan', side_effect=changed_during_call), self.assertRaises(SceneError) as error:
            variants.refine(self.session, self.room, self.job_id, payload)
        self.assertEqual(error.exception.code, 'revision_conflict')
        job = SceneDesignJob.objects.get(pk=self.job_id)
        self.assertEqual(job.data['variantSet']['variants'][0]['instances'], draft['variants'][0]['instances'])

    def test_initial_unknown_reference_returns_clarification_without_any_drafts(self):
        async def unclear(*args):
            return {'variants': variants.fallback_baskets(variants.candidate_catalogue()),
                    'layoutRequest': None, 'clarification': 'Which item do you mean by styroom?'}
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test'}), patch('api.designer_variants.agent_baskets', side_effect=unclear):
            result = variants.begin(self.session, self.room, self.payload)
            result = variants.poll(self.session, self.room, result['jobId'])
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['error']['code'], 'clarification')
        self.assertIn('styroom', result['error']['message'])

    def test_initial_layout_request_is_extracted_once_and_applied_to_all_three_drafts(self):
        async def interpretation(*args):
            return {'variants': variants.fallback_baskets(variants.candidate_catalogue()),
                    'layoutRequest': 'Keep the couch beside the bed; move the smallest accessory toward the front-left corner.',
                    'clarification': None, 'preserveBedSofaAdjacency': True}
        def arrange(state, text):
            import asyncio
            import json
            from agents.tool_context import ToolContext
            target = state.instances[-1]['instanceId']
            result = asyncio.run(designer_refinement.move_to_region.on_invoke_tool(
                ToolContext(context=state, tool_name='move_to_region', tool_call_id='initial-test', tool_arguments='{}'),
                json.dumps({'reference_id': target, 'region': 'front_left'})))
            self.assertTrue(result['ok'], result)
            return PlanReply(apply=True, message='Moved the accessory toward the front-left room corner.')
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test'}), \
                patch('api.designer_variants.agent_baskets', side_effect=interpretation) as curator, \
                patch('api.designer_refinement.plan', side_effect=arrange) as refiner:
            result = self.complete()
        self.assertEqual(curator.call_count, 1)
        self.assertEqual(refiner.call_count, 3)
        for variant in result['variants']:
            self.assertIn('front-left', variant['layoutMessage'])
            self.assertEqual(len(variant['instances']), 5)
            self.assertLessEqual(variant['totalCents'], 120000)
            validate_instances(variant['instances'], self.room)
        self.assertEqual(scene_for_session(self.session, self.room).instances, [])

    def test_initial_layout_cannot_replace_selected_basket(self):
        draft = self.complete()
        job = SceneDesignJob.objects.get(pk=self.job_id)
        job.data['layoutRequest'] = 'Move the sofa toward the left.'
        with self.assertRaises(SceneError) as error:
            variants.apply_initial_layout(job, copy.deepcopy(draft['variants'][0]))
        self.assertEqual(error.exception.code, 'layout_unresolved')

    def test_expensive_or_unknown_model_cannot_mutate_a_draft(self):
        draft = self.complete()
        job = SceneDesignJob.objects.get(pk=self.job_id)
        snapshot = copy.deepcopy(job.data['snapshot'])
        snapshot.update(instances=draft['variants'][0]['instances'], products=draft['variants'][0]['products'])
        expensive = [p.model_copy(update={'price_cents': 120000}) if p.id == 'demo-brown-sofa' else p for p in CATALOGUE]
        state = designer_refinement.DraftState(snapshot, str(uuid.uuid4()), {p.id:p for p in expensive}, 120000)
        for product, code in [('invented', 'unknown_price'), ('demo-brown-sofa', 'budget')]:
            with self.assertRaises(SceneError) as error:
                state.replace(draft['variants'][0]['sofaInstanceId'], product)
            self.assertEqual(error.exception.code, code)
            self.assertEqual(state.instances, snapshot['instances'])

    def test_corner_move_is_valid_and_keeps_siblings_and_saved_scene(self):
        import asyncio
        import json
        from agents.tool_context import ToolContext
        draft = self.complete()
        active = draft['variants'][0]
        target = active['instances'][-1]['instanceId']
        payload = {'variantId': active['id'], 'baseRevision': 0, 'requestId': str(uuid.uuid4()),
                   'text': 'Please put the pouf in the front left corner.'}
        def move(state, text):
            result = asyncio.run(designer_refinement.move_to_region.on_invoke_tool(
                ToolContext(context=state, tool_name='move_to_region', tool_call_id='corner-test', tool_arguments='{}'),
                json.dumps({'reference_id': target, 'region': 'front_left'})))
            self.assertTrue(result['ok'], result)
            return PlanReply(apply=True, message='Moved the pouf toward the front-left corner using room axes.')
        with patch('api.designer_refinement.plan', side_effect=move):
            result = variants.refine(self.session, self.room, self.job_id, payload)['variantSet']
        self.assertEqual(result['variants'][1:], draft['variants'][1:])
        updated = result['variants'][0]
        validate_instances(updated['instances'], self.room)
        self.assertNotEqual(updated['instances'][-1]['pose'], active['instances'][-1]['pose'])
        self.assertEqual(updated['instances'][:-1], active['instances'][:-1])
        self.assertEqual(scene_for_session(self.session, self.room).instances, [])

    def test_session_scope_and_scene_revision_prevent_wrong_acceptance(self):
        result = self.complete()
        active = result['variants'][0]
        with self.assertRaises(SceneError) as error:
            variants.selected_variant('other', self.room, self.job_id, active['id'], 0)
        self.assertEqual(error.exception.code, 'not_found')
        scene = scene_for_session(self.session,self.room)
        scene.revision = 1
        scene.save()
        with self.assertRaises(SceneError) as error:
            variants.selected_variant(self.session,self.room,self.job_id,active['id'],0)
        self.assertEqual(error.exception.code, 'revision_conflict')

    def test_unknown_prices_and_changed_total_block_acceptance(self):
        result = self.complete()
        active = result['variants'][0]
        changed = [p.model_copy(update={'price_cents':0}) if p.id == 'demo-oak-platform-bed' else p for p in CATALOGUE]
        with patch('api.designer_variants.load_catalogue', return_value=changed), self.assertRaises(SceneError) as error:
            variants.selected_variant(self.session,self.room,self.job_id,active['id'],0)
        self.assertEqual(error.exception.code, 'unknown_price')
        changed = [p.model_copy(update={'price_cents':40000}) if p.id == 'demo-oak-platform-bed' else p for p in CATALOGUE]
        with patch('api.designer_variants.load_catalogue', return_value=changed), self.assertRaises(SceneError) as error:
            variants.selected_variant(self.session,self.room,self.job_id,active['id'],0)
        self.assertEqual(error.exception.code, 'price_changed')

    def test_agent_selection_used_when_configured_and_valid(self):
        async def picked(*args):
            baskets = variants.fallback_baskets(variants.candidate_catalogue())
            baskets[0]['label'] = 'Agent selected bedroom'
            return baskets
        with patch.dict(os.environ, {'OPENAI_API_KEY':'test'}), patch('api.designer_variants.agent_baskets', side_effect=picked):
            result = self.complete()
        self.assertEqual(result['source'], 'agent')
        self.assertEqual(result['variants'][0]['label'], 'Agent selected bedroom')

    def test_draft_generation_does_not_resume_as_saved_scene_designer(self):
        first = variants.begin(self.session, self.room, self.payload)
        self.assertEqual(variants.begin(self.session, self.room, self.payload)['jobId'],first['jobId'])
        self.assertIsNone(active_request(scene_for_session(self.session,self.room)))
        with self.assertRaises(SceneError) as error:
            variants.begin(self.session,self.room,{**self.payload,'text':'Different request'})
        self.assertEqual(error.exception.code, 'request_conflict')

    def test_selected_draft_is_frozen_after_acceptance(self):
        result = self.complete()
        active = result['variants'][0]
        job, selected = variants.selected_variant(self.session,self.room,self.job_id,active['id'],0)
        variants.mark_accepted(job, selected['id'], 1)
        with self.assertRaises(SceneError) as error:
            variants.selected_variant(self.session,self.room,self.job_id,active['id'],0)
        self.assertEqual(error.exception.code,'design_locked')

    def test_exact_prompt_through_csrf_protected_http_routes(self):
        client = Client(enforce_csrf_checks=True)
        room_url = '?roomId=' + self.room
        self.assertEqual(client.get('/api/scene/' + room_url).status_code, 200)
        endpoint = '/api/designer/variants/'
        denied = client.post(endpoint + room_url, self.payload, content_type='application/json')
        self.assertEqual(denied.status_code, 403)
        headers = {'HTTP_X_CSRFTOKEN': client.cookies['csrftoken'].value}
        response = client.post(endpoint + room_url, self.payload, content_type='application/json', **headers)
        self.assertEqual(response.status_code, 200, response.content)
        job_id = response.json()['jobId']
        for _ in range(4):
            response = client.post(endpoint + job_id + '/' + room_url, {}, content_type='application/json', **headers)
            self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertEqual(result['status'], 'completed', result)
        self.assertEqual(len(result['variantSet']['variants']), 3)
        self.assertEqual(result['variantSet']['fallbackReason'], 'agent_unconfigured')
        saved = client.get('/api/scene/' + room_url).json()
        self.assertEqual((saved['instances'], saved['revision']), ([], 0))


class BatchTwoPlacementTests(SimpleTestCase):
    """Real landed catalogue dimensions and reviewed Haussmann floor; no provider."""
    def setUp(self):
        from types import SimpleNamespace
        from .scene_service import room_context
        self.snapshot = room_context('haussmann-apartment')
        self.snapshot.update(instances=[], revision=0)
        self.job = SimpleNamespace(pk=uuid.uuid4(), data={'snapshot': self.snapshot, 'payload': {}})

    def test_three_real_beds_produce_distinct_geometry_valid_budgeted_drafts(self):
        available = variants.candidate_catalogue()
        expected = {'demo-oak-platform-bed', 'demo-walnut-slat-bed', 'demo-upholstered-linen-bed'}
        self.assertTrue(expected <= set(available))
        self.assertTrue(all(available[key].price_cents == 39900 for key in expected))
        baskets = variants.fallback_baskets(available)
        seen = set()
        for index, basket in enumerate(baskets):
            draft = variants.build_variant(self.job, basket, index)
            validate_instances(draft['instances'], 'haussmann-apartment')
            seen.add(draft['instances'][0]['productId'])
            self.assertLessEqual(draft['totalCents'], 120000)
            self.assertTrue(variants.valid_basket(basket, available))
            self.assertFalse(designer_refinement.UNSUPPORTED_FLOOR_MODELS & set(basket['productIds']))
        self.assertEqual(seen, expected)
        self.assertEqual(self.snapshot['instances'], [])

    def test_unsupported_accessories_remain_catalogued_but_are_excluded_from_automatic_choices(self):
        import asyncio
        from agents.tool_context import ToolContext
        blocked = designer_refinement.UNSUPPORTED_FLOOR_MODELS
        catalogue = variants.catalogue()
        self.assertTrue(blocked <= set(catalogue))
        self.assertTrue(all(catalogue_product(key)['modelUrl'] for key in blocked))
        self.assertFalse(blocked & set(variants.candidate_catalogue()))
        draft = variants.build_variant(self.job, variants.fallback_baskets(variants.candidate_catalogue())[0], 0)
        snapshot = {**self.snapshot, 'instances': draft['instances'], 'products': draft['products']}
        state = designer_refinement.DraftState(snapshot, str(uuid.uuid4()), catalogue, 120000)
        context = ToolContext(context=state, tool_name='list_priced_models', tool_call_id='placement-policy', tool_arguments='{}')
        choices = asyncio.run(designer_refinement.list_priced_models.on_invoke_tool(context, '{}'))
        self.assertFalse(blocked & {p['productId'] for p in choices['products']})
        before = copy.deepcopy(state.instances)
        target = state.instances[-1]
        for key in blocked:
            with self.assertRaises(SceneError) as replacement:
                state.replace(target['instanceId'], key)
            self.assertEqual(replacement.exception.code, 'unsupported_placement')
            with self.assertRaises(SceneError) as addition:
                state.stage(key, {'xCm': 100, 'zCm': 100, 'yawRad': 0})
            self.assertEqual(addition.exception.code, 'unsupported_placement')
            self.assertEqual(state.instances, before)
            bad_basket = {'productIds': [i['productId'] for i in before[:-1]] + [key]}
            self.assertFalse(variants.valid_basket(bad_basket, catalogue))


class RealCatalogueDesignCheckoutTests(AccountTestCase):
    """Real landed GLBs/prices + real HTTP/session/auth paths, isolated test database.

    Stops at immutable draft review; never approves or calls Visa.
    """
    def send(self, path, data):
        return self.client.post(path, data, content_type='application/json',
                                HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    @patch('api.designer_refinement.plan', side_effect=brown_plan)
    def test_brown_design_locks_only_selected_items_and_creates_exact_review(self, _planner):
        from checkout.models import Checkout
        from shopping.models import CartItem

        cart = self.client.get('/api/cart/').json()
        other = {'instanceId': 'other-room-pouf', 'productId': 'demo-boucle-pouf',
                 'product': catalogue_product('demo-boucle-pouf'),
                 'pose': {'xCm': 200, 'zCm': 200, 'yawRad': 0}}
        response = self.send('/api/cart/confirm-placement/', {'roomId': 'empty-room', 'instance': other,
            'baseRevision': 0, 'cartRevision': cart['revision'], 'operationId': 'preserve-other-room'})
        self.assertEqual(response.status_code, 200, response.content)
        cart = response.json()['cart']
        old = {'instanceId': 'old-haussmann-nightstand', 'productId': 'demo-oak-nightstand',
               'product': catalogue_product('demo-oak-nightstand'),
               'pose': {'xCm': 90, 'zCm': 150, 'yawRad': 0}}
        response = self.send('/api/cart/confirm-placement/', {'roomId': 'haussmann-apartment', 'instance': old,
            'baseRevision': 0, 'cartRevision': cart['revision'], 'operationId': 'replace-existing-room'})
        self.assertEqual(response.status_code, 200, response.content)
        original = response.json()
        room_query = '?roomId=haussmann-apartment'
        response = self.send('/api/designer/variants/' + room_query, {
            'text': 'I have a $1200 budget. Design me a warm bedroom. I want a couch beside the bed.',
            'requestId': str(uuid.uuid4()), 'baseRevision': original['scene']['revision']})
        self.assertEqual(response.status_code, 200, response.content)
        endpoint = '/api/designer/variants/' + response.json()['jobId'] + '/'
        with patch.dict(os.environ, {'OPENAI_API_KEY': ''}):
            for _ in range(4):
                response = self.send(endpoint + room_query, {})
                self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertEqual(result['status'], 'completed', result)
        draft = result['variantSet']
        chosen = draft['variants'][0]
        response = self.send(endpoint + 'refine/' + room_query, {
            'variantId': chosen['id'], 'baseRevision': chosen['revision'],
            'requestId': str(uuid.uuid4()), 'text': 'Actually, change the couch to a more brownish color.'})
        self.assertEqual(response.status_code, 200, response.content)
        refined = response.json()['variantSet']['variants'][0]
        lock = {'roomId': 'haussmann-apartment', 'variantSetId': draft['variantSetId'],
                'variantId': refined['id'], 'baseRevision': 0, 'requestId': str(uuid.uuid4())}
        stale = self.send('/api/checkout/lock-design/', lock)
        self.assertEqual(stale.status_code, 409, stale.content)
        self.assertEqual(stale.json()['error']['code'], 'revision_conflict')
        self.assertEqual(self.client.get('/api/cart/').json()['amount'], original['cart']['amount'])
        self.assertEqual(self.client.get('/api/scene/' + room_query).json()['revision'], original['scene']['revision'])

        lock.update(baseRevision=refined['revision'], requestId=str(uuid.uuid4()))
        response = self.send('/api/checkout/lock-design/', lock)
        self.assertEqual(response.status_code, 200, response.content)
        locked = response.json()
        selected = {i['instanceId']: i['productId'] for i in refined['instances']}
        room_items = [i for i in locked['cart']['items'] if i['roomId'] == 'haussmann-apartment']
        self.assertEqual({i['instanceId']: i['product_id'] for i in room_items}, selected)
        self.assertIn('demo-brown-linen-sofa', selected.values())
        self.assertNotIn('demo-cream-linen-sofa', selected.values())
        self.assertEqual(sum(i['unit_amount'] for i in room_items), refined['totalCents'])
        self.assertEqual(locked['cart']['amount'], refined['totalCents'] + 5900)
        self.assertEqual(locked['cart']['item_count'], len(refined['instances']) + 1)
        sibling_ids = {i['instanceId'] for v in draft['variants'][1:] for i in v['instances']}
        self.assertFalse(sibling_ids & {i['instanceId'] for i in locked['cart']['items']})
        self.assertEqual([i['instanceId'] for i in locked['cart']['items'] if i['roomId'] == 'empty-room'], ['other-room-pouf'])
        self.assertFalse(CartItem.objects.get(instance_id='old-haussmann-nightstand').selected)
        self.assertEqual(self.client.get('/api/scene/' + room_query).json()['instances'], refined['instances'])
        self.assertEqual(locked['sceneRevision'], original['scene']['revision'] + 1)
        retry = self.send('/api/checkout/lock-design/', lock)
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.json(), locked)
        self.assertEqual(self.client.get('/api/scene/' + room_query).json()['revision'], locked['sceneRevision'])
        frozen = self.send('/api/checkout/lock-design/', {**lock, 'requestId': str(uuid.uuid4())})
        self.assertEqual(frozen.status_code, 409, frozen.content)
        self.assertEqual(frozen.json()['error']['code'], 'design_locked')
        guest_review = self.send('/api/cart/checkout/', {'revision': locked['cart']['revision']})
        self.assertEqual(guest_review.status_code, 401, guest_review.content)
        self.assertEqual(Checkout.objects.count(), 0)

        self.enrolled()
        ack = self.send('/api/accounts/recovery/acknowledge/', {'acknowledged': True})
        self.assertEqual(ack.status_code, 200, ack.content)
        claim = self.send('/api/cart/claim/', {})
        self.assertEqual(claim.status_code, 200, claim.content)
        with patch('checkout.services.submit_idx') as visa:
            review = self.send('/api/cart/checkout/', {'revision': locked['cart']['revision']})
            self.assertEqual(review.status_code, 201, review.content)
            checkout = review.json()
            self.assertEqual(checkout['state'], 'draft')
            self.assertEqual(checkout['snapshot']['amount'], locked['cart']['amount'])
            self.assertEqual(checkout['snapshot']['item_count'], len(refined['instances']) + 1)
            expected = {}
            for product_id in list(selected.values()) + [other['productId']]:
                expected[product_id] = expected.get(product_id, 0) + 1
            self.assertEqual({i['product_id']: i['quantity'] for i in checkout['snapshot']['items']}, expected)
            repeated = self.send('/api/cart/checkout/', {'revision': locked['cart']['revision']})
            self.assertEqual(repeated.json()['id'], checkout['id'])
            visa.assert_not_called()
        self.assertEqual(Checkout.objects.count(), 1)
