"""Prepare the creator's HAUSSMANN download without cropping or rescaling it."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    stage = ROOT / '.scratch/gaussian/source'
    stage.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.archive) as archive:
        license_text = archive.read('license.txt').decode('utf8')
        if 'HAUSSMANN APARTMENT' not in license_text or 'creativecommons.org/licenses/by/4.0/' not in license_text:
            raise ValueError('Expected creator HAUSSMANN archive and CC BY 4.0 license')
        if archive.getinfo('scene.ply').file_size > 1_000_000_000:
            raise ValueError('Unexpectedly large scene')
        with archive.open('scene.ply') as source, (stage / 'scene.ply').open('wb') as output:
            shutil.copyfileobj(source, output)
    source = stage / 'scene.ply'
    with source.open('rb') as stream:
        header = []
        for _ in range(256):
            line = stream.readline().decode('ascii').strip()
            header.append(line)
            if line == 'end_header':
                break
        else:
            raise ValueError('Missing bounded PLY header')
    required = ['scale_0', 'scale_1', 'scale_2', 'opacity', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'f_dc_0', 'f_dc_1', 'f_dc_2']
    if any('property float ' + name not in header for name in required):
        raise ValueError('Expected real Gaussian properties')
    sha = digest(source)
    if sha != '167fbe4c98379cb92b9f36c91463a3fb4ead84dc91cccf0dac58d82365a69e38':
        raise ValueError('Source differs from the reviewed room; re-review transforms and geometry first')
    assets = ROOT / 'shared/rooms/haussmann-apartment/assets'
    assets.mkdir(parents=True, exist_ok=True)
    (assets.parent / 'license.txt').write_text(license_text)
    target = assets / f'room-full-{sha[:12]}.sog'
    cli = ROOT / 'frontend/node_modules/.bin/splat-transform'
    version = json.loads((ROOT / 'frontend/node_modules/@playcanvas/splat-transform/package.json').read_text())['version']
    if version != '3.4.2':
        raise ValueError('Reviewed preparation requires splat-transform 3.4.2')
    if target.exists():
        raise FileExistsError(f'Immutable output already exists: {target}')
    subprocess.run([str(cli), str(source), str(target)], check=True)
    surface = ROOT / '.scratch/gaussian/surface.voxel.json'
    subprocess.run([str(cli), str(source), str(surface), '--voxel-size', '0.05', '--collision-mesh', 'faces', '--overwrite'], check=True)
    reference = assets / f'surface-full-{sha[:12]}.collision.glb'
    shutil.copyfile(surface.with_suffix('').with_suffix('.collision.glb'), reference)
    report = {'surface': {'name': reference.name, 'bytes': reference.stat().st_size, 'sha256': digest(reference)}, 'archiveSha256': digest(args.archive), 'sourceSha256': sha,
              'sourceHeader': header, 'tool': version, 'cropped': False, 'decimated': False,
              'output': {'name': target.name, 'bytes': target.stat().st_size, 'sha256': digest(target)},
              'calibration': 'Source units assumed meters; not measured. Manifest supplies orientation/translation.'}
    (assets / 'preparation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['output']))

if __name__ == '__main__':
    main()
