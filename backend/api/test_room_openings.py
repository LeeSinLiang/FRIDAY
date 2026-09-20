"""A room's openings.json must describe the room's own model, and must never disturb its import.

The model is licensed and not in Git, so the comparison with it runs only where it has been imported.
The structural checks always run.
"""
import importlib.util
import json
import unittest
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

REPO = Path(settings.BASE_DIR).parent
ROOM = REPO / 'shared' / 'rooms' / 'cg-arch-interior'
MODEL = ROOM / 'assets' / 'room.glb'


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, REPO / 'scripts' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RoomOpeningsTests(SimpleTestCase):
    def setUp(self):
        self.openings = json.loads((ROOM / 'openings.json').read_text())
        areas = json.loads((ROOM / 'spatial.json').read_text())['freeAreas']
        self.free = {key: (min if key.startswith('min') else max)(area[key] for area in areas)
                     for key in ('minXcm', 'maxXcm', 'minZcm', 'maxZcm')}

    def test_the_window_lies_within_its_wall(self):
        [window] = self.openings['openings']
        self.assertEqual((window['id'], window['kind'], window['wall']), ('w1', 'window', 'n'))
        wall_length = self.free['maxXcm'] - self.free['minXcm']
        self.assertGreaterEqual(window['startCm'], 0)
        self.assertLessEqual(window['startCm'] + window['widthCm'], wall_length)

    def test_openings_stay_out_of_the_files_the_room_importer_compares_byte_for_byte(self):
        # import-room.sh refuses a room whose manifest or spatial file differs from its bundle. Openings
        # therefore live in their own file; if they ever move into one of these, every import breaks.
        bundle = load_script('room_bundle')
        self.assertNotIn('openings.json', bundle.FILES)
        for name in ('manifest.json', 'spatial.json'):
            for key in ('openings', 'portals'):
                self.assertNotIn(key, json.loads((ROOM / name).read_text()).get('room', {}))
                self.assertNotIn(key, json.loads((ROOM / name).read_text()))

    def test_internal_corridor_connection_needs_no_portal(self):
        self.assertEqual(self.openings['portals'], [])
        self.assertIn('no boundary', self.openings['portalsNote'])

    @unittest.skipUnless(MODEL.is_file(), 'the licensed room model is not imported on this machine')
    def test_the_window_is_where_the_model_has_its_glass(self):
        from api.glb import read_glb
        document, _ = read_glb(MODEL)
        [glass] = [entry for entry in load_script('room_openings').glazing(document) if entry['node'] == 'Room Glass Windows']
        self.assertEqual(glass['own_transform'], [], 'the measurement assumes an untransformed node')
        [window] = self.openings['openings']
        start_cm = self.free['minXcm'] + window['startCm']
        self.assertAlmostEqual(start_cm, 100 * glass['min_m'][0], delta=0.5)
        self.assertAlmostEqual(start_cm + window['widthCm'], 100 * glass['max_m'][0], delta=0.5)
        self.assertAlmostEqual(window['sillCm'], 100 * glass['min_m'][1], delta=0.5)
        self.assertAlmostEqual(window['headCm'], 100 * glass['max_m'][1], delta=0.5)
        # On the north side: the glass stands behind the free floor's z-min edge, not inside the floor.
        self.assertLess(100 * glass['max_m'][2], self.free['minZcm'])
