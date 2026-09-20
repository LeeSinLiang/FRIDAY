"""Preserve existing preset layouts and their receipts through room-key migration."""
from datetime import timedelta

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.exceptions import IrreversibleError
from django.test import TransactionTestCase
from django.utils import timezone


class RoomKeyMigrationTests(TransactionTestCase):
    old_target = [('api', '0003_scenecapture_completed_at')]
    new_target = [('api', '0004_prepared_rooms')]

    def migrate(self, target):
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        return executor.loader.project_state(target).apps

    def setUp(self):
        super().setUp()
        self.addCleanup(self.migrate, self.new_target)
        self.old_apps = self.migrate(self.old_target)

    def test_existing_default_and_studio_roundtrip_preserves_related_records(self):
        Layout = self.old_apps.get_model('api', 'SceneLayout')
        Receipt = self.old_apps.get_model('api', 'SceneCommandReceipt')
        Capture = self.old_apps.get_model('api', 'SceneCapture')
        instances = [{'instanceId': 'kept', 'productId': 'test-chair',
                      'pose': {'xCm': 100, 'zCm': 100, 'yawRad': 0}}]
        default = Layout.objects.create(session_key='existing-session', instances=[], revision=3)
        studio = Layout.objects.create(session_key='existing-session:studio', instances=instances, revision=7)
        updated_at = studio.updated_at
        receipt = Receipt.objects.create(scene_id=studio.pk, command_id='already-applied',
                                         payload_hash='a' * 64, response={'revision': 7, 'instances': instances})
        capture = Capture.objects.create(scene_id=studio.pk, request_id='existing-capture',
                                         payload_hash='b' * 64, snapshot={'instances': instances}, revision=7,
                                         view='top', width=320, height=240,
                                         expires_at=timezone.now() + timedelta(minutes=5), image=b'existing-image')
        current = self.migrate(self.new_target)
        NewLayout = current.get_model('api', 'SceneLayout')
        migrated = NewLayout.objects.get(session_key='existing-session', room_id='studio')
        self.assertEqual((migrated.pk, migrated.instances, migrated.revision, migrated.updated_at),
                         (studio.pk, instances, 7, updated_at))
        self.assertEqual(NewLayout.objects.get(session_key='existing-session', room_id='demo-room').pk, default.pk)
        self.assertEqual(current.get_model('api', 'SceneCommandReceipt').objects.get(pk=receipt.pk).scene_id, studio.pk)
        migrated_capture = current.get_model('api', 'SceneCapture').objects.get(pk=capture.pk)
        self.assertEqual((migrated_capture.scene_id, bytes(migrated_capture.image), migrated_capture.representation),
                         (studio.pk, b'existing-image', 'photographic'))

        restored = self.migrate(self.old_target)
        OldLayout = restored.get_model('api', 'SceneLayout')
        self.assertEqual(OldLayout.objects.get(pk=studio.pk).session_key, 'existing-session:studio')
        self.assertEqual(OldLayout.objects.get(pk=default.pk).session_key, 'existing-session')
        self.assertEqual(restored.get_model('api', 'SceneCommandReceipt').objects.get(pk=receipt.pk).response,
                         {'revision': 7, 'instances': instances})
        self.assertEqual(restored.get_model('api', 'SceneCapture').objects.get(pk=capture.pk).snapshot,
                         {'instances': instances})
        # Applying the migration again must not duplicate or reseed either layout.
        current = self.migrate(self.new_target)
        self.assertEqual(current.get_model('api', 'SceneLayout').objects.count(), 2)
        self.assertEqual(current.get_model('api', 'SceneLayout').objects.get(pk=studio.pk).instances, instances)

    def test_rollback_rejects_unrepresentable_room_without_losing_layout(self):
        current = self.migrate(self.new_target)
        Layout = current.get_model('api', 'SceneLayout')
        row = Layout.objects.create(session_key='s' * 32, room_id='long-prepared-room-id', revision=9)
        with self.assertRaisesMessage(IrreversibleError, 'legacy unique 40-character session keys'):
            self.migrate(self.old_target)
        preserved = Layout.objects.get(pk=row.pk)
        self.assertEqual((preserved.session_key, preserved.room_id, preserved.revision),
                         ('s' * 32, 'long-prepared-room-id', 9))
