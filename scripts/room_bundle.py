#!/usr/bin/env python3
"""Pack/import the reviewed Cg Arch fixture without Blender or network access."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ROOM = 'cg-arch-interior'
FILES = ('manifest.json', 'spatial.json', 'license.txt', 'assets/room.glb')
MAX_BYTES = 256 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pack(root, output):
    room = root / 'shared' / 'rooms' / ROOM
    payload = {name: (room / name).read_bytes() for name in FILES}
    metadata = {'version': 1, 'roomId': ROOM, 'files': {
        name: {'sha256': digest(data), 'bytes': len(data)} for name, data in payload.items()}}
    output.parent.mkdir(parents=True, exist_ok=True)
    # Never replace an earlier package implicitly.
    with zipfile.ZipFile(output, 'x', zipfile.ZIP_DEFLATED) as archive:
        for name, data in payload.items():
            archive.writestr(name, data)
        archive.writestr('bundle.json', json.dumps(metadata, indent=2))
    return digest(output.read_bytes())


def install(root, source, expected=None):
    if source.stat().st_size > MAX_BYTES:
        raise ValueError('Bundle exceeds 256 MiB limit.')
    if expected and digest(source.read_bytes()) != expected.lower():
        raise ValueError('ZIP SHA-256 does not match the sender checksum.')
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) != len(FILES) + 1 or {x.filename for x in entries} != set(FILES) | {'bundle.json'}:
            raise ValueError('Unexpected, duplicate or missing archive paths.')
        if sum(x.file_size for x in entries) > MAX_BYTES:
            raise ValueError('Expanded bundle exceeds 256 MiB limit.')
        if archive.getinfo('bundle.json').file_size > 65536:
            raise ValueError('Bundle metadata is too large.')
        meta = json.loads(archive.read('bundle.json'))
        if meta.get('version') != 1 or meta.get('roomId') != ROOM or set(meta.get('files', {})) != set(FILES):
            raise ValueError('Unsupported room bundle.')
        payload = {}
        for name in FILES:
            data = archive.read(name)
            if meta['files'][name] != {'sha256': digest(data), 'bytes': len(data)}:
                raise ValueError('Integrity check failed: ' + name)
            payload[name] = data
    room = root / 'shared' / 'rooms' / ROOM
    # Metadata stays in Git: never overwrite a collaborator's calibration or layout contract.
    for name in FILES[:3]:
        target = room / name
        if target.is_symlink() or target.read_bytes() != payload[name]:
            raise ValueError('Repository metadata differs: ' + name + '. Update to the matching mesh checkpoint first.')
    for path in (root / 'shared', root / 'shared/rooms', room, room / 'assets', room / 'assets/room.glb'):
        if path.is_symlink():
            raise ValueError('Refusing symlink destination: ' + str(path))
    data = payload['assets/room.glb']
    if len(data) < 12 or data[:4] != b'glTF' or int.from_bytes(data[4:8], 'little') != 2 or int.from_bytes(data[8:12], 'little') != len(data):
        raise ValueError('Invalid GLB header or length.')
    target = room / 'assets/room.glb'
    if target.exists() and digest(target.read_bytes()) == digest(data):
        return 'Already installed; checksum matches.'
    if target.exists():
        raise ValueError('A different room.glb exists. Back it up and move it aside before importing.')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        # Atomic create, not replace: concurrent imports cannot overwrite an existing room.
        os.link(temporary, target)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    return 'Installed room. Restart ./run-local.sh, then open /?room=cg-arch-interior.'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    export = commands.add_parser('pack')
    export.add_argument('output', type=Path)
    load = commands.add_parser('import')
    load.add_argument('source', type=Path)
    load.add_argument('--sha256', help='ZIP checksum supplied separately by the sender')
    args = parser.parse_args()
    try:
        if args.command == 'pack':
            checksum = pack(ROOT, args.output)
            print(f'{checksum}  {args.output.name}')
        else:
            print(install(ROOT, args.source, args.sha256))
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        parser.exit(1, f'Room bundle: {error}\n')


if __name__ == '__main__':
    main()
