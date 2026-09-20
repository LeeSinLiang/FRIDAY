"""Every furniture asset must be the size its listing says, standing on the floor.

This is the cross-lane check between the catalogue (integer millimetres) and the 3D assets (GLB,
metres). Its job is the 2.6x class of error, a generator that normalises to a unit cube or an export
in centimetres, which renders silently at the wrong size. It is deliberately NOT tight: a check that
cries wolf over two percent gets switched off, and then it catches nothing.
"""
import json
import shutil
import tempfile
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

from .catalogue_products import catalogue_product
from .glb import fit_to_height, measure

ASSETS = Path(settings.BASE_DIR).parent / 'shared' / 'models' / 'furniture'
TOLERANCE_CM = 2.0
TOLERANCE_RATIO = 0.03
FLOOR_TOLERANCE_CM = 1.0
CENTRE_TOLERANCE_CM = 2.0
MAX_BYTES = 5 * 1024 * 1024
MAX_TRIANGLES = 30000


def allowed(expected_cm):
    """2 cm or 3 percent, whichever is larger."""
    return max(TOLERANCE_CM, TOLERANCE_RATIO * expected_cm)


def asset_folders():
    return sorted(path.parent for path in ASSETS.glob('*/metadata.json'))


class FurnitureAssetTests(SimpleTestCase):
    def test_there_is_at_least_one_asset_to_check(self):
        self.assertTrue(asset_folders(), 'the check below would pass vacuously')

    def test_every_asset_matches_its_listing_and_stands_on_the_floor(self):
        for folder in asset_folders():
            with self.subTest(asset=folder.name):
                metadata = json.loads((folder / 'metadata.json').read_text())
                box = measure(folder / 'model.glb')
                width, height, depth = (100 * metres for metres in box['size'])  # glTF: X width, Y up, Z depth

                product = catalogue_product(metadata['catalogueListingId'])
                self.assertIsNotNone(product, 'catalogueListingId must name a real catalogue listing')
                self.assertEqual(product['modelUrl'], metadata['modelUrl'], 'the listing must point at this model')
                for name, measured, listed, declared in (('width', width, product['widthCm'], metadata['widthCm']),
                                                         ('height', height, product['heightCm'], metadata['heightCm']),
                                                         ('depth', depth, product['depthCm'], metadata['depthCm'])):
                    self.assertLessEqual(abs(measured - listed), allowed(listed),
                                         f'{name}: model is {measured:.1f} cm, listing says {listed:g} cm. '
                                         f'A large miss means wrong units or an unscaled generator export.')
                    self.assertEqual(declared, listed, f'{name}: metadata.json and the catalogue listing disagree')

                self.assertLessEqual(abs(100 * box['min'][1]), FLOOR_TOLERANCE_CM,
                                     f"lowest point is at y = {100 * box['min'][1]:.1f} cm; the pivot must be on the floor or the item floats or sinks")
                for axis, label in ((0, 'x'), (2, 'z')):
                    centre = 100 * (box['min'][axis] + box['max'][axis]) / 2
                    self.assertLessEqual(abs(centre), CENTRE_TOLERANCE_CM, f'footprint is off-centre in {label} by {centre:.1f} cm')
                self.assertLessEqual(box['bytes'], MAX_BYTES)
                self.assertLessEqual(box['triangles'], MAX_TRIANGLES)

    def test_the_check_really_catches_a_unit_cube_export(self):
        """Undo the fit on a copy and make sure the numbers it would have failed on are the ones we saw."""
        folder = asset_folders()[0]
        with tempfile.TemporaryDirectory() as scratch:
            copy = Path(scratch) / 'model.glb'
            shutil.copy(folder / 'model.glb', copy)
            fit_to_height(copy, 1.8987)  # back to the generator's scale, but standing on the floor
            raw = measure(copy)
            self.assertGreater(100 * raw['size'][0] - 71, allowed(71) * 10, 'a 2.6x model must miss by far more than the tolerance')

    def test_fitting_is_uniform_and_lands_on_the_floor(self):
        folder = asset_folders()[0]
        with tempfile.TemporaryDirectory() as scratch:
            copy = Path(scratch) / 'model.glb'
            shutil.copy(folder / 'model.glb', copy)
            before = measure(copy)
            applied = fit_to_height(copy, 0.5)
            after = measure(copy)
            self.assertAlmostEqual(after['size'][1], 0.5, places=6)
            self.assertAlmostEqual(after['min'][1], 0.0, places=6)
            for axis in range(3):  # proportions are untouched: uniform scale only
                self.assertAlmostEqual(after['size'][axis] / before['size'][axis], applied['scale'], places=6)
