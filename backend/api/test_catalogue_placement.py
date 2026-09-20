"""Placing real catalogue listings in a scene. No network; the catalogue is the in-memory one."""
from django.test import Client, TestCase

from catalogue.feed import load_listings

from .catalogue_products import catalogue_product
from .scene_service import SceneError, validate_instances

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
            'fixture product carrying one': {'instanceId': 'x', 'productId': 'test-chair', 'product': POANG, 'pose': self.poang['pose']},
            'unknown instance key': dict(self.poang, note='hi'),
        }
        for name, instance in cases.items():
            with self.assertRaises(SceneError, msg=name):
                validate_instances([instance])
            self.assertEqual(self.commands([{'type': 'add', 'instance': instance}], command_id=name[:20]).status_code, 400, name)
        self.assertEqual(self.client.get('/api/scene/').json()['revision'], 0)

    def test_fixture_products_are_untouched(self):
        chair = {'instanceId': 'chair-1', 'productId': 'test-chair', 'pose': {'xCm': 100, 'zCm': 100, 'yawRad': 0}}
        self.assertEqual(self.commands([{'type': 'add', 'instance': chair}]).json()['instances'], [chair])
        self.assertEqual(len(self.client.get('/api/scene/').json()['products']), 3)

    def test_too_big_for_the_room_is_a_placement_error_like_any_other(self):
        wardrobe = catalogue_product('ikea-490.462.37')  # PAX, 236 cm tall, fits under 280
        self.assertEqual(wardrobe['heightCm'], 236)
        outside = {'instanceId': 'pax-1', 'productId': wardrobe['productId'], 'product': wardrobe, 'pose': {'xCm': 10, 'zCm': 10, 'yawRad': 0}}
        response = self.commands([{'type': 'add', 'instance': outside}])
        self.assertEqual((response.status_code, response.json()['error']['message']), (400, 'Outside room.'))
