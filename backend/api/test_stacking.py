"""Catalogue-backed tabletop placement and floor regression tests."""
from unittest.mock import patch

from django.test import SimpleTestCase

from .catalogue_products import catalogue_product
from .scene_service import SceneError, validate_instances


class StackingTests(SimpleTestCase):
    def setUp(self):
        self.table = catalogue_product('ikea-702.211.42')
        self.vase = catalogue_product('abo-B07B8NVHX1')
        self.room = {'roomId': 'comparison', 'revision': 1, 'widthCm': 600, 'depthCm': 500, 'heightCm': 280}
        self.support = {'instanceId': 'table-1', 'productId': self.table['productId'], 'product': self.table,
                        'pose': {'xCm': 300, 'zCm': 250, 'yawRad': 0}}
        self.candidate = {'instanceId': 'vase-1', 'productId': self.vase['productId'], 'product': self.vase,
                          'pose': {'xCm': 300, 'zCm': 250, 'yawRad': 0}}

    def validate(self, instances):
        with patch('api.scene_service.room_context', return_value={'room': self.room, 'products': []}):
            return validate_instances(instances)

    def test_tabletop_accepts_both_input_orders_and_keeps_pose_horizontal(self):
        self.assertIs(self.table['supportSurface'], True)
        self.assertNotIn('supportSurface', self.vase)
        for instances in ([self.support, self.candidate], [self.candidate, self.support]):
            stored = self.validate(instances)
            self.assertEqual(stored, instances)
            self.assertEqual(set(stored[-1]['pose']), {'xCm', 'zCm', 'yawRad'})

    def test_edge_rotation_and_height_rejections(self):
        self.candidate['pose']['xCm'] = 364.6
        self.validate([self.support, self.candidate])
        self.candidate['pose']['xCm'] = 364.600002
        with self.assertRaises(SceneError):
            self.validate([self.support, self.candidate])
        self.candidate['pose']['xCm'] = 363
        self.candidate['pose']['yawRad'] = 3.141592653589793 / 4
        with self.assertRaises(SceneError):
            self.validate([self.support, self.candidate])
        self.candidate['pose'] = {'xCm': 300, 'zCm': 250, 'yawRad': 0}
        self.room['heightCm'] = 90
        with self.assertRaises(SceneError):
            self.validate([self.support, self.candidate])

    def test_floor_placement_and_non_surface_collision_stay_intact(self):
        self.candidate['pose']['xCm'] = 100
        self.candidate['pose']['zCm'] = 100
        self.validate([self.support, self.candidate])
        self.support['product'] = dict(self.table, supportSurface=False)
        self.candidate['pose'] = {'xCm': 300, 'zCm': 250, 'yawRad': 0}
        # The caller cannot forge or erase an explicit support flag.
        with self.assertRaises(SceneError):
            self.validate([self.support, self.candidate])
        self.support['product'] = self.table
        self.candidate['product'] = dict(self.vase, supportSurface=True)
        with self.assertRaises(SceneError):
            self.validate([self.support, self.candidate])
        self.candidate['product'] = self.vase
        self.support = {'instanceId': 'vase-2', 'productId': self.vase['productId'], 'product': self.vase,
                        'pose': {'xCm': 300, 'zCm': 250, 'yawRad': 0}}
        with self.assertRaises(SceneError):
            self.validate([self.support, self.candidate])
