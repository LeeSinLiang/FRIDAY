"""Only committed agent placements publish revision-scoped furniture motion."""
from django.test import TestCase

from .models import SceneCommandReceipt
from .scene_service import (
    SceneError, apply_scene_commands, attempt_placement, scene_for_session, serialize,
)


class AgentMotionTests(TestCase):
    session = 'agent-motion-test'

    def instance(self, x=180):
        return {'instanceId': 'sofa', 'productId': 'test-sofa',
                'pose': {'xCm': x, 'zCm': 200, 'yawRad': 0}}

    def place(self, command='add-sofa', revision=0, x=180, **extra):
        return attempt_placement(self.session, {
            'commandId': command, 'baseRevision': revision,
            'instance': self.instance(x), **extra,
        })

    def snapshot(self):
        return serialize(scene_for_session(self.session))

    def test_agent_add_is_returned_and_persisted_for_polling(self):
        result = self.place()
        expected = {'revision': 1, 'instanceId': 'sofa', 'fromPose': None,
                    'toPose': self.instance()['pose']}
        self.assertTrue(result['applied'])
        self.assertEqual(result['agentMotion'], expected)
        self.assertEqual(self.snapshot()['agentMotion'], expected)

    def test_agent_move_uses_previously_committed_pose(self):
        self.place()
        result = self.place('move-sofa', 1, 300)
        self.assertEqual(result['agentMotion'], {
            'revision': 2, 'instanceId': 'sofa',
            'fromPose': self.instance()['pose'], 'toPose': self.instance(300)['pose'],
        })
        self.assertEqual(self.snapshot()['agentMotion'], result['agentMotion'])

    def test_manual_revision_clears_event_and_cannot_create_one(self):
        self.place()
        result = apply_scene_commands(self.session, 1, 'manual-move', [{
            'type': 'setPose', 'instanceId': 'sofa', 'pose': self.instance(300)['pose'],
        }])
        self.assertEqual(result['revision'], 2)
        self.assertNotIn('agentMotion', result)
        self.assertNotIn('agentMotion', self.snapshot())
        result = apply_scene_commands(self.session, 2, 'manual-remove', [{
            'type': 'remove', 'instanceId': 'sofa',
        }])
        self.assertNotIn('agentMotion', result)

    def test_dry_run_and_rejection_do_not_publish_motion(self):
        result = self.place(dryRun=True)
        self.assertFalse(result['applied'])
        self.assertNotIn('agentMotion', result)
        with self.assertRaises(SceneError):
            self.place(x=10)
        self.assertEqual(self.snapshot()['revision'], 0)
        self.assertNotIn('agentMotion', self.snapshot())
        self.assertEqual(SceneCommandReceipt.objects.count(), 0)

    def test_noop_receipts_do_not_replace_original_motion(self):
        original = self.place()['agentMotion']
        noop = self.place('same-pose', 1)
        self.assertFalse(noop['applied'])
        self.assertEqual(noop['agentMotion'], original)
        # A later receipt with no motion metadata must not mask the agent event.
        SceneCommandReceipt.objects.create(
            scene=scene_for_session(self.session), command_id='older-client-noop',
            payload_hash='noop', response={'revision': 1},
        )
        self.assertEqual(self.snapshot()['agentMotion'], original)

    def test_retry_returns_original_event_without_advancing_revision(self):
        first = self.place()
        self.assertEqual(self.place(), first)
        self.assertEqual(self.snapshot()['revision'], 1)
        self.assertEqual(SceneCommandReceipt.objects.count(), 1)
        self.place('move-sofa', 1, 300)
        self.assertEqual(self.place(), first)
        self.assertEqual(self.snapshot()['agentMotion']['revision'], 2)

    def test_manual_add_gets_helpers_but_history_restore_does_not(self):
        result = apply_scene_commands(self.session, 0, 'user-add', [{
            'type': 'add', 'instance': self.instance(),
        }])
        self.assertEqual(result['agentMotion']['fromPose'], None)
        self.assertEqual(result['agentMotion']['instanceId'], 'sofa')
        self.assertEqual(self.snapshot()['agentMotion'], result['agentMotion'])
        result = apply_scene_commands(self.session, 1, 'history-restore', [
            {'type': 'remove', 'instanceId': 'sofa'},
            {'type': 'add', 'instance': self.instance(300)},
        ])
        self.assertNotIn('agentMotion', result)
