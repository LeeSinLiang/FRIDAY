"""Package only runtime JSON beside Django; Vercel flattens the project root."""
import json
from pathlib import Path
import shutil


def package_shared():
    source = Path(__file__).resolve().parent.parent / 'shared'
    target = Path(__file__).resolve().parent / 'runtime_shared'
    if target.exists():
        shutil.rmtree(target)  # This directory contains only regenerable build output.
    files = [source/'scene-fixtures.json', source/'public-rooms.json']
    for room in json.loads((source/'public-rooms.json').read_text()):
        directory = source/'rooms'/room['id']
        manifest = directory/'manifest.json'
        spatial = directory/json.loads(manifest.read_text())['spatialFile']
        if spatial.resolve().parent != directory.resolve():
            raise ValueError('Room spatial metadata must remain inside its directory')
        files.extend([manifest, spatial])
    files.extend((source/'models/furniture').glob('*/metadata.json'))
    for path in files:
        destination = target/path.relative_to(source)
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(path,destination)
    print(f'Packaged {len(files)} runtime JSON files; no models, captures or private files')


if __name__ == '__main__':
    package_shared()
