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
from .glb import MAX_ANISOTROPY, anisotropy, capped_factors, fit_root_scale, fit_to_box, fit_to_height, measure
from .scene_service import fixtures

ASSETS = Path(settings.BASE_DIR).parent / 'shared' / 'models' / 'furniture'
TOLERANCE_CM = 2.0
TOLERANCE_RATIO = 0.03
FLOOR_TOLERANCE_CM = 1.0
CENTRE_TOLERANCE_CM = 2.0
MAX_BYTES = 5 * 1024 * 1024
MAX_TRIANGLES = 30000
# The regression tests below replay what happened to one specific asset, so they name it. Picking
# "the first folder" would silently test a different model the day a lamp sorts ahead of this chair.
HERRAKRA = ASSETS / 'herrakra-armchair-diseroed-dark-yellow'
HERRAKRA_GENERATED_HEIGHT_M = 1.8987
HERRAKRA_LISTED_WIDTH_CM = 71


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

                # The existing generated demo sofa has no retail listing. Its canonical
                # contract is the scene fixture; new retail assets must still name a listing.
                legacy_sofa = folder.name == 'modular-sofa-grey-scan'
                if legacy_sofa:
                    product = next(p for p in fixtures()['products'] if p['productId'] == folder.name)
                    self.assertEqual(metadata['productId'], product['productId'])
                else:
                    product = catalogue_product(metadata['catalogueListingId'])
                self.assertIsNotNone(product, 'asset must name its authoritative product')
                if metadata.get('unbound'):
                    # A model that misses its listing's size is kept in the repo but must not render:
                    # a true-size box is honest, a sofa 14 cm too narrow in a fit check is not.
                    self.assertNotIn('modelUrl', product, 'an unbound asset must not be linked from its listing')
                    continue
                self.assertEqual(product['modelUrl'], metadata['modelUrl'], 'the listing must point at this model')
                for name, measured, listed, declared in (('width', width, product['widthCm'], metadata['widthCm']),
                                                         ('height', height, product['heightCm'], metadata['heightCm']),
                                                         ('depth', depth, product['depthCm'], metadata['depthCm'])):
                    self.assertLessEqual(abs(measured - listed), allowed(listed),
                                         f'{name}: model is {measured:.1f} cm, listing says {listed:g} cm. '
                                         f'A large miss means wrong units or an unscaled generator export.')
                    self.assertEqual(declared, listed, f'{name}: metadata.json and the catalogue listing disagree')

                self.assert_stretch_is_within_the_cap(folder, metadata, (width, height, depth), product)
                self.assertLessEqual(abs(100 * box['min'][1]), FLOOR_TOLERANCE_CM,
                                     f"lowest point is at y = {100 * box['min'][1]:.1f} cm; the pivot must be on the floor or the item floats or sinks")
                for axis, label in ((0, 'x'), (2, 'z')):
                    centre = 100 * (box['min'][axis] + box['max'][axis]) / 2
                    self.assertLessEqual(abs(centre), CENTRE_TOLERANCE_CM, f'footprint is off-centre in {label} by {centre:.1f} cm')
                # Grandfather only the documented sofa budget; do not silently permit
                # larger future versions or relax the budget for other assets.
                self.assertLessEqual(box['bytes'], 10814596 if legacy_sofa else MAX_BYTES)
                self.assertLessEqual(box['triangles'], 46385 if legacy_sofa else MAX_TRIANGLES)

    def test_the_check_really_catches_a_unit_cube_export(self):
        """Undo the fit on a copy and make sure the numbers it would have failed on are the ones we saw."""
        with tempfile.TemporaryDirectory() as scratch:
            copy = Path(scratch) / 'model.glb'
            shutil.copy(HERRAKRA / 'model.glb', copy)
            fit_to_height(copy, HERRAKRA_GENERATED_HEIGHT_M)  # back to the generator's scale, but standing on the floor
            raw = measure(copy)
            self.assertGreater(100 * raw['size'][0] - HERRAKRA_LISTED_WIDTH_CM, allowed(HERRAKRA_LISTED_WIDTH_CM) * 10,
                               'a 2.6x model must miss by far more than the tolerance')

    def test_fitting_is_uniform_and_lands_on_the_floor(self):
        with tempfile.TemporaryDirectory() as scratch:
            copy = Path(scratch) / 'model.glb'
            shutil.copy(HERRAKRA / 'model.glb', copy)
            before = measure(copy)
            applied = fit_to_height(copy, 0.5)
            after = measure(copy)
            self.assertAlmostEqual(after['size'][1], 0.5, places=6)
            self.assertAlmostEqual(after['min'][1], 0.0, places=6)
            for axis in range(3):  # proportions are untouched: uniform scale only
                self.assertAlmostEqual(after['size'][axis] / before['size'][axis], 0.5 / before['size'][1], places=6)
            # A second fit replaces the first instead of nesting inside it, so the scale is the bare model's.
            self.assertAlmostEqual(applied['scale'], 0.5 / HERRAKRA_GENERATED_HEIGHT_M, places=3)
            self.assertEqual(fit_root_scale(copy), [applied['scale']] * 3)

    def assert_stretch_is_within_the_cap(self, folder, metadata, measured_cm, product):
        """Read from the GLB itself, not from what metadata claims: a fitted model is never stretched past the cap."""
        scale = fit_root_scale(folder / 'model.glb')
        if scale is None:
            return
        self.assertLessEqual(anisotropy(scale), MAX_ANISOTROPY,
                             f'stretched {100 * anisotropy(scale):.1f}% out of proportion; past {100 * MAX_ANISOTROPY:.0f}% it is a '
                             f'different object wearing this listing\'s name. Leave it unbound instead.')
        fit = metadata.get('fit', {})
        if 'scale' in fit:  # a per-axis fit must say so, and say how far from exact it landed
            for recorded, actual in zip(fit['scale'], scale):
                self.assertAlmostEqual(recorded, actual, places=3, msg='metadata fit.scale does not describe this file')
            listed = (product['widthCm'], product['heightCm'], product['depthCm'])
            for key, measured, target in zip(('width', 'height', 'depth'), measured_cm, listed):
                self.assertAlmostEqual(fit['residualCm'][key], measured - target, delta=0.05,
                                       msg=f'{key}: the recorded residual is not the real one')

    def test_a_per_axis_fit_is_exact_inside_the_cap(self):
        factors = capped_factors([1.496, 0.74, 0.799], [1.40, 0.74, 0.78])  # the LISABO table as generated
        self.assertLessEqual(anisotropy(factors), MAX_ANISOTROPY)
        for size, factor, target in zip([1.496, 0.74, 0.799], factors, [1.40, 0.74, 0.78]):
            self.assertAlmostEqual(size * factor, target, places=9)

    def test_a_per_axis_fit_stops_at_the_cap_and_spreads_the_miss(self):
        size, target = [1.8013, 1.0, 2.1898], [1.62, 1.0, 2.12]  # the RAMNEFJALL bed: exact needs 11.2%
        factors = capped_factors(size, target)
        self.assertLessEqual(anisotropy(factors), MAX_ANISOTROPY)
        self.assertGreater(anisotropy(factors), MAX_ANISOTROPY - 1e-6, 'it should use all of the cap it is allowed')
        misses = [100 * (s * f - t) for s, f, t in zip(size, factors, target)]
        self.assertAlmostEqual(misses[0], -misses[1], places=3)  # the worst miss is shared, not dumped on one axis
        self.assertLess(max(abs(m) for m in misses), 0.7)

    def test_a_different_object_cannot_be_stretched_into_the_listing(self):
        size, target = [1.650, 0.88, 0.994], [1.79, 0.88, 0.88]  # the EKTORP model against the real EKTORP
        factors = capped_factors(size, target)
        self.assertLessEqual(anisotropy(factors), MAX_ANISOTROPY)
        worst = max(abs(100 * (s * f - t)) for s, f, t in zip(size, factors, target))
        self.assertGreater(worst, allowed(179), 'at the cap it must still fail the asset check, so it stays unbound')

    def test_fit_to_box_is_lossless_and_repeatable(self):
        with tempfile.TemporaryDirectory() as scratch:
            copy = Path(scratch) / 'model.glb'
            shutil.copy(HERRAKRA / 'model.glb', copy)
            first = fit_to_box(copy, [0.71, 0.73, 0.66])
            once = copy.read_bytes()
            second = fit_to_box(copy, [0.71, 0.73, 0.66])
            self.assertEqual(once, copy.read_bytes(), 'fitting twice must not nest one root inside another')
            self.assertEqual(first['scale'], second['scale'])
            self.assertLessEqual(first['anisotropy'], MAX_ANISOTROPY)
            self.assertAlmostEqual(measure(copy)['min'][1], 0.0, places=6)
