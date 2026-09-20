"""Room presets: a second, tight room with its own per-session layout. The default room is untouched."""
from django.test import Client, TestCase

from .scene_service import SceneError, fixtures, layout_key, room_id_of, validate_instances


class RoomPresetTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.assertEqual(self.client.get('/api/scene/').status_code, 200)
        self.token = self.client.cookies['csrftoken'].value

    def put(self, instances, revision=0):
        return self.client.put('/api/scene/', {'baseRevision': revision, 'instances': instances}, content_type='application/json', HTTP_X_CSRFTOKEN=self.token)

    def test_default_room_is_exactly_as_before(self):
        scene = self.client.get('/api/scene/').json()
        self.assertEqual((scene['room']['roomId'], scene['room']['widthCm'], scene['instances']), ('demo-room', 600, []))
        self.assertNotIn('rooms', scene)
        self.assertEqual((layout_key('abc'), room_id_of('abc')), ('abc', None))

    def test_the_studio_starts_furnished_and_keeps_its_own_layout(self):
        self.client.cookies['friday_room'] = 'studio'
        studio = self.client.get('/api/scene/').json()
        self.assertEqual((studio['room']['widthCm'], studio['room']['depthCm']), (260, 200))
        self.assertEqual([item['instanceId'] for item in studio['instances']], ['studio-table', 'studio-chair'])
        self.assertEqual(self.put([]).status_code, 200)  # clearing it is a normal edit
        self.assertEqual(self.client.get('/api/scene/').json()['instances'], [])  # and it is not re-seeded
        self.client.cookies['friday_room'] = ''
        self.assertEqual(self.client.get('/api/scene/').json()['room']['widthCm'], 600)
        chair = {'instanceId': 'c', 'productId': 'test-chair', 'pose': {'xCm': 500, 'zCm': 400, 'yawRad': 0}}
        self.assertEqual(self.put([chair]).status_code, 200)
        self.client.cookies['friday_room'] = 'studio'
        self.assertEqual(self.client.get('/api/scene/').json()['instances'], [])  # the living room's chair did not follow

    def test_placement_is_judged_against_the_room_in_use(self):
        chair = {'instanceId': 'c', 'productId': 'test-chair', 'pose': {'xCm': 500, 'zCm': 400, 'yawRad': 0}}
        self.assertEqual(validate_instances([chair]), [chair])
        with self.assertRaises(SceneError) as caught:
            validate_instances([chair], 'studio')
        self.assertEqual(caught.exception.message, 'Outside room.')
        self.client.cookies['friday_room'] = 'studio'
        self.assertEqual(self.put([chair], revision=0).status_code, 400)

    def test_the_seeded_layout_is_itself_valid(self):
        self.assertEqual(len(validate_instances(fixtures_preset('studio')['instances'], 'studio')), 2)

    def test_an_unknown_room_falls_back_to_the_default(self):
        self.client.cookies['friday_room'] = 'ballroom'
        self.assertEqual(self.client.get('/api/scene/').json()['room']['widthCm'], 600)
        with self.assertRaises(SceneError):
            layout_key('abc', 'ballroom')
        self.assertLessEqual(len(layout_key('x' * 32, 'studio')), 40)  # fits SceneLayout.session_key


def fixtures_preset(room_id):
    import json
    from pathlib import Path
    from django.conf import settings
    return json.loads((Path(settings.BASE_DIR).parent / 'shared' / 'scene-fixtures.json').read_text())['rooms'][room_id]
