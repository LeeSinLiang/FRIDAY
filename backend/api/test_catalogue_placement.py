"""Placing real catalogue listings in a scene. No network; the catalogue is the in-memory one."""
from django.test import Client, TestCase

from catalogue.feed import load_listings

from .catalogue_products import catalogue_product
from .scene_service import FLAT_MAX_CM, SceneError, fixtures, is_flat, validate_instances

POANG_ID = 'ikea-193.025.39'
POANG = {'productId': POANG_ID, 'name': 'POÄNG armchair', 'widthCm': 68, 'depthCm': 82, 'heightCm': 100,
         'color': '#c9a77c', 'kind': 'chair'}


class CatalogueProductTests(TestCase):
    def test_a_listing_becomes_a_product_in_centimetres(self):
        listing = next(item for item in load_listings() if item.id == POANG_ID)
        self.assertEqual((listing.dims_mm.w, listing.dims_mm.d, listing.dims_mm.h), (680, 820, 1000))
        self.assertEqual(catalogue_product(POANG_ID), POANG)
        self.assertIsNone(catalogue_product('ikea-000.000.00'))

    def test_every_category_maps_to_a_scene_kind_and_seed_listings_resolve(self):
        for listing in load_listings():
            self.assertIn(catalogue_product(listing.id)['kind'], {'sofa', 'table', 'chair'})
        self.assertEqual(catalogue_product('seed-000001')['productId'], 'seed-000001')


class CataloguePlacementTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.assertEqual(self.client.get('/api/scene/').status_code, 200)
        self.token = self.client.cookies['csrftoken'].value
        self.poang = {'instanceId': 'poang-1', 'productId': POANG_ID, 'product': POANG, 'pose': {'xCm': 300, 'zCm': 250, 'yawRad': 0}}

    def commands(self, commands, revision=0, command_id='c1'):
        return self.client.post('/api/scene/commands/', {'baseRevision': revision, 'commandId': command_id, 'commands': commands},
                                content_type='application/json', HTTP_X_CSRFTOKEN=self.token)

    def test_end_to_end_a_poang_is_placed_by_its_real_catalogue_id(self):
        added = self.commands([{'type': 'add', 'instance': self.poang}])
        self.assertEqual(added.status_code, 200, added.content)
        snapshot = self.client.get('/api/scene/').json()
        self.assertEqual(snapshot['instances'], [self.poang])
        # The product list now includes it, from the server's catalogue, alongside the untouched fixtures.
        by_id = {product['productId']: product for product in snapshot['products']}
        self.assertEqual(by_id[POANG_ID], POANG)
        self.assertEqual({'test-sofa', 'test-table', 'test-chair'} - set(by_id), set())
        # It behaves like any other instance afterwards: it can move, it collides, it can be removed.
        moved = self.commands([{'type': 'setPose', 'instanceId': 'poang-1', 'pose': {'xCm': 100, 'zCm': 100, 'yawRad': 1.5707963267948966}}], 1, 'c2')
        self.assertEqual(moved.status_code, 200, moved.content)
        sofa = {'instanceId': 'sofa-1', 'productId': 'test-sofa', 'pose': {'xCm': 120, 'zCm': 100, 'yawRad': 0}}
        blocked = self.commands([{'type': 'add', 'instance': sofa}], 2, 'c3')
        self.assertEqual((blocked.status_code, blocked.json()['error']['message']), (400, 'Overlaps POÄNG armchair.'))
        self.assertEqual(self.commands([{'type': 'remove', 'instanceId': 'poang-1'}], 2, 'c4').json()['instances'], [])

    def test_a_second_copy_is_added_the_way_the_furniture_rail_adds_it(self):
        # Once a catalogue piece stands in the room the snapshot lists its product, so the editor's rail offers it
        # again. The rail's add carries that listed product (instanceToAdd in frontend/src/scene/products.ts). The
        # bare add it used to send is still refused: the server's rule did not move.
        self.assertEqual(self.commands([{'type': 'add', 'instance': self.poang}]).status_code, 200)
        listed = next(p for p in self.client.get('/api/scene/').json()['products'] if p['productId'] == POANG_ID)
        second = {'instanceId': 'poang-2', 'productId': POANG_ID, 'pose': {'xCm': 450, 'zCm': 250, 'yawRad': 0}}
        bare = self.commands([{'type': 'add', 'instance': second}], 1, 'c2')
        self.assertEqual((bare.status_code, bare.json()['error']['message']), (400, 'A catalogue item must carry its product.'))
        carried = self.commands([{'type': 'add', 'instance': dict(second, product=listed)}], 1, 'c3')
        self.assertEqual(carried.status_code, 200, carried.content)
        self.assertEqual([item['instanceId'] for item in carried.json()['instances']], ['poang-1', 'poang-2'])

    def test_full_snapshot_save_round_trips_the_carried_product(self):
        saved = self.client.put('/api/scene/', {'baseRevision': 0, 'instances': [self.poang]}, content_type='application/json', HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()['instances'], [self.poang])

    def test_the_server_not_the_client_decides_the_dimensions(self):
        shrunk = dict(self.poang, product=dict(POANG, widthCm=30))
        response = self.commands([{'type': 'add', 'instance': shrunk}])
        self.assertEqual(response.status_code, 400)
        with self.assertRaises(SceneError) as caught:
            validate_instances([shrunk])
        self.assertEqual(caught.exception.details['issues'][0]['code'], 'product_mismatch')
        self.assertEqual(caught.exception.details['issues'][0]['catalogueCm'], {'widthCm': 68, 'depthCm': 82, 'heightCm': 100})
        self.assertEqual(self.client.get('/api/scene/').json()['instances'], [])

    def test_rejected_without_changing_the_scene(self):
        cases = {
            'not in the catalogue': dict(self.poang, productId='made-up-1', product=dict(POANG, productId='made-up-1')),
            'catalogue id without its product': {k: v for k, v in self.poang.items() if k != 'product'},
            'carried id differs': dict(self.poang, product=dict(POANG, productId='ikea-291.292.29')),
            'missing field': dict(self.poang, product={k: v for k, v in POANG.items() if k != 'kind'}),
            'extra field': dict(self.poang, product=dict(POANG, priceCents=1)),
            'non-finite': dict(self.poang, product=dict(POANG, depthCm=True)),
            'kind the editor cannot load': dict(self.poang, product=dict(POANG, kind='bed')),
            'blank name': dict(self.poang, product=dict(POANG, name='  ')),
            'name not text': dict(self.poang, product=dict(POANG, name=7)),
            'colour not text': dict(self.poang, product=dict(POANG, color=None)),
            'model url not text': dict(self.poang, product=dict(POANG, modelUrl=5)),
            'oversized name': dict(self.poang, product=dict(POANG, name='x' * 513)),
            'fixture product carrying one': {'instanceId': 'x', 'productId': 'test-chair', 'product': POANG, 'pose': self.poang['pose']},
            'unknown instance key': dict(self.poang, note='hi'),
        }
        for name, instance in cases.items():
            with self.assertRaises(SceneError, msg=name):
                validate_instances([instance])
            self.assertEqual(self.commands([{'type': 'add', 'instance': instance}], command_id=name[:20]).status_code, 400, name)
        self.assertEqual(self.client.get('/api/scene/').json()['revision'], 0)

    def test_what_is_stored_is_the_servers_copy_so_the_editor_can_always_load_it_back(self):
        # Right dimensions, but the client renamed and recoloured it. Accepted, and normalised.
        relabelled = dict(self.poang, product=dict(POANG, name='Free chair!!', color='#000000', kind='sofa'))
        response = self.commands([{'type': 'add', 'instance': relabelled}])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['instances'][0]['product'], POANG)
        self.assertEqual(self.client.get('/api/scene/').json()['instances'][0]['product'], POANG)

    def test_fixture_products_are_untouched(self):
        chair = {'instanceId': 'chair-1', 'productId': 'test-chair', 'pose': {'xCm': 100, 'zCm': 100, 'yawRad': 0}}
        self.assertEqual(self.commands([{'type': 'add', 'instance': chair}]).json()['instances'], [chair])
        self.assertEqual(self.client.get('/api/scene/').json()['products'], fixtures()['products'])

    def test_too_big_for_the_room_is_a_placement_error_like_any_other(self):
        wardrobe = catalogue_product('ikea-490.462.37')  # PAX, 236 cm tall, fits under 280
        self.assertEqual(wardrobe['heightCm'], 236)
        outside = {'instanceId': 'pax-1', 'productId': wardrobe['productId'], 'product': wardrobe, 'pose': {'xCm': 10, 'zCm': 10, 'yawRad': 0}}
        response = self.commands([{'type': 'add', 'instance': outside}])
        self.assertEqual((response.status_code, response.json()['error']['message']), (400, 'Outside room.'))

    # ---- A rug does not stop a chair. The same rule, and the same cases, as the editor's check in
    # frontend/src/scene/placement.ts (frontend/src/region/cataloguePlacement.test.ts): the two must agree. ----

    def carried(self, title_word, instance_id, x=300, z=250, **overrides):
        listing = next(item for item in load_listings() if item.title.startswith(title_word))
        product = {**catalogue_product(listing.id), **overrides}
        return {'instanceId': instance_id, 'productId': listing.id, 'product': product, 'pose': {'xCm': x, 'zCm': z, 'yawRad': 0}}

    def test_a_rug_neither_blocks_nor_is_blocked_in_either_order(self):
        rug, pile = self.carried('LOHALS', 'rug-1'), self.carried('VINDUM', 'rug-2', x=320, z=260)
        self.assertEqual((rug['product']['heightCm'], pile['product']['heightCm'], FLAT_MAX_CM), (1.0, 3.0, 3))
        on_the_rug = self.commands([{'type': 'add', 'instance': rug}, {'type': 'add', 'instance': self.poang}])
        self.assertEqual(on_the_rug.status_code, 200, on_the_rug.content)
        # A rug slid under the chair that is already there, overlapping the first rug too; 3.0 cm is exactly the line.
        under = self.commands([{'type': 'add', 'instance': pile}], revision=1, command_id='c2')
        self.assertEqual(under.status_code, 200, under.content)
        self.assertEqual([i['instanceId'] for i in under.json()['instances']], ['rug-1', 'poang-1', 'rug-2'])

    def test_a_rug_is_still_an_item_in_a_room_and_a_millimetre_over_the_line_is_furniture(self):
        outside = self.commands([{'type': 'add', 'instance': self.carried('LOHALS', 'rug-1', x=50)}])
        self.assertEqual((outside.status_code, outside.json()['error']['message']), (400, 'Outside room.'))
        # The line itself. (A carried product with a made-up height cannot test this end to end: the server
        # refuses it for disagreeing with the catalogue before it ever gets to overlap.)
        self.assertEqual([is_flat({'heightCm': h}) for h in (1.0, 3.0, 3.1, 73)], [True, True, False, False])
        # And ordinary furniture still collides, exactly as before.
        second = {**self.poang, 'instanceId': 'poang-2', 'pose': {'xCm': 310, 'zCm': 250, 'yawRad': 0}}
        refused = self.commands([{'type': 'add', 'instance': self.poang}, {'type': 'add', 'instance': second}])
        self.assertEqual((refused.status_code, refused.json()['error']['message']), (400, 'Overlaps POÄNG armchair.'))
