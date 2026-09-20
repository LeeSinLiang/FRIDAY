"""Package only runtime JSON beside Django; Vercel flattens the project root."""
import json
import re
from pathlib import Path
import shutil


def package_shared(source=None, target=None):
    source = source or Path(__file__).resolve().parent.parent / 'shared'
    target = target or Path(__file__).resolve().parent / 'runtime_shared'
    if target.exists():
        shutil.rmtree(target)  # This directory contains only regenerable build output.
    files = [source/'scene-fixtures.json', source/'public-rooms.json']
    pending = [room['id'] for room in json.loads((source/'public-rooms.json').read_text())]
    seen = set()
    while pending:
        room_id = pending.pop(0)
        if room_id in seen:
            continue
        if not isinstance(room_id, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', room_id):
            raise ValueError('Invalid public building floor ID')
        seen.add(room_id)
        directory = source/'rooms'/room_id
        manifest = directory/'manifest.json'
        data = json.loads(manifest.read_text())
        spatial = directory/data['spatialFile']
        if spatial.resolve().parent != directory.resolve():
            raise ValueError('Room spatial metadata must remain inside its directory')
        files.extend([manifest, spatial])
        pending.extend(level['roomId'] for level in data['room'].get('scan', {}).get('building', {}).get('levels', []))
        pending.extend(data['room'].get('scan', {}).get('building', {}).get('legacyRoomIds', []))
    files.extend((source/'models/furniture').glob('*/metadata.json'))
    for path in files:
        destination = target/path.relative_to(source)
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(path,destination)
    print(f'Packaged {len(files)} runtime JSON files; no models, captures or private files')


if __name__ == '__main__':
    package_shared()
