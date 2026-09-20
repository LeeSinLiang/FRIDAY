import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from room_bundle import FILES, ROOM, install, pack


class RoomBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source, self.dest = self.root / 'source', self.root / 'dest'
        for root in (self.source, self.dest):
            room = root / 'shared/rooms' / ROOM
            room.mkdir(parents=True)
            for name in FILES[:3]:
                (room / name).write_text('{}' if name.endswith('.json') else 'Attribution')
        room = self.source / 'shared/rooms' / ROOM
        (room / 'assets').mkdir()
        (room / 'assets/room.glb').write_bytes(b'glTF' + (2).to_bytes(4, 'little') + (12).to_bytes(4, 'little'))
        self.archive = self.root / 'room.zip'
        self.checksum = pack(self.source, self.archive)
        self.target = self.dest / 'shared/rooms' / ROOM / 'assets/room.glb'

    def test_roundtrip_and_idempotence(self):
        self.assertIn('Installed', install(self.dest, self.archive, self.checksum))
        self.assertIn('Already installed', install(self.dest, self.archive))
        self.assertEqual(self.target.read_bytes(), (self.source / 'shared/rooms' / ROOM / 'assets/room.glb').read_bytes())

    def test_wrong_checksum_and_metadata_leave_destination_untouched(self):
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            install(self.dest, self.archive, '0' * 64)
        (self.dest / 'shared/rooms' / ROOM / 'spatial.json').write_text('{"changed":true}')
        with self.assertRaisesRegex(ValueError, 'metadata differs'):
            install(self.dest, self.archive)
        self.assertFalse(self.target.exists())

    def test_unexpected_paths_and_corruption_are_rejected(self):
        with zipfile.ZipFile(self.archive, 'a') as archive:
            archive.writestr('../escape', b'bad')
        with self.assertRaisesRegex(ValueError, 'archive paths'):
            install(self.dest, self.archive)
        self.assertFalse((self.dest / 'escape').exists())
        damaged = self.root / 'damaged.zip'
        with zipfile.ZipFile(self.archive) as original, zipfile.ZipFile(damaged, 'w') as archive:
            for name in FILES + ('bundle.json',):
                archive.writestr(name, b'bad' if name == 'assets/room.glb' else original.read(name))
        with self.assertRaisesRegex(ValueError, 'Integrity'):
            install(self.dest, damaged)

    def test_existing_files_and_symlinks_are_not_overwritten(self):
        self.target.parent.mkdir()
        self.target.write_bytes(b'valuable')
        with self.assertRaisesRegex(ValueError, 'different room'):
            install(self.dest, self.archive)
        self.assertEqual(self.target.read_bytes(), b'valuable')
        self.target.unlink()
        external = self.root / 'external'
        external.write_bytes(b'keep')
        self.target.symlink_to(external)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            install(self.dest, self.archive)
        self.assertEqual(external.read_bytes(), b'keep')


if __name__ == '__main__':
    unittest.main()
