"""Prepare the CC BY Studio 11 archive locally; no capture data is uploaded."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
ROOM = ROOT / 'shared' / 'rooms' / 'studio-11'
ASSETS = ROOM / 'assets'
CLI = ROOT / 'frontend' / 'node_modules' / '.bin' / 'splat-transform'
OUTPUTS = ['room.sog', 'surface.voxel.json', 'surface.voxel.bin', 'surface.collision.glb']
SETTINGS = {
    'pipelineVersion': 1,
    'visualQuality': 'adaptive2m',
    'visualTargetGaussians': 2_000_000,
    'decimateArguments': ['--decimate-adaptive', '2000000'],
    'surfaceArguments': ['--voxel-size', '0.05', '--collision-mesh', 'faces'],
    'surfaceSource': 'original',
    'navigationCarving': False,
}


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(4 * 1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def already_prepared(archive_hash, version):
    """A matching input is insufficient after corruption or a changed pipeline."""
    try:
        previous = json.loads((ASSETS / 'preparation.json').read_text())
        if previous['archiveSha256'] != archive_hash or previous['tool'] != version or previous['settings'] != SETTINGS:
            return False
        for name in OUTPUTS:
            path, expected = ASSETS / name, previous['outputs'][name]
            if not path.is_file() or path.stat().st_size != expected['bytes'] or digest(path) != expected['sha256']:
                return False
        return digest(ROOM / 'license.txt') == previous['licenseSha256']
    except (OSError, ValueError, KeyError, TypeError):
        return False


def publish(staged_assets, staged_license):
    """Publish only complete conversions, restoring the old package on failure."""
    backup = Path(tempfile.mkdtemp(prefix='.prepare-backup-', dir=ROOM))
    targets = [(staged_assets, ASSETS), (staged_license, ROOM / 'license.txt')]
    saved, installed = [], []
    try:
        for source, target in targets:
            if target.exists():
                old = backup / target.name
                os.replace(target, old)
                saved.append((old, target))
            os.replace(source, target)
            installed.append(target)
    except BaseException:
        for target in reversed(installed):
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        for old, target in reversed(saved):
            os.replace(old, target)
        # If restoration itself fails, leave the backup available for recovery.
        shutil.rmtree(backup)
        raise
    shutil.rmtree(backup)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, help='Path to the downloaded Studio 11.zip')
    parser.add_argument('--force', action='store_true', help='Regenerate the prepared outputs')
    args = parser.parse_args()
    if not CLI.exists():
        parser.error('Run ./setup.sh first to install the pinned SplatTransform tool.')
    archive_hash = digest(args.archive)
    version = subprocess.check_output([str(CLI), '--version'], text=True).strip()
    if not args.force and already_prepared(archive_hash, version):
        print('Studio 11 adaptive2m assets and hashes are current. Use --force to regenerate.')
        return
    ROOM.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.prepare-staging-', dir=ROOM) as directory:
        stage = Path(directory)
        staged_assets = stage / 'assets'
        staged_assets.mkdir()
        staged_license = stage / 'license.txt'
        source = staged_assets / 'source.ply'
        with zipfile.ZipFile(args.archive) as archive:
            # Select exact files; never extract arbitrary archive paths or execute contents.
            license_text = archive.read('license.txt').decode('utf-8')
            if 'Studio 11' not in license_text or 'creativecommons.org/licenses/by/4.0' not in license_text:
                parser.error('This script expects the Studio 11 archive with its CC BY 4.0 license.')
            if archive.getinfo('scene.ply').file_size > 1_000_000_000:
                parser.error('Unexpectedly large Studio 11 input.')
            staged_license.write_text(license_text)
            with archive.open('scene.ply') as stream, source.open('wb') as output:
                shutil.copyfileobj(stream, output)
        print(f'Preparing Studio 11 adaptive2m locally with {version}', flush=True)
        adaptive = stage / 'adaptive.ply'
        subprocess.run([str(CLI), str(source), *SETTINGS['decimateArguments'], str(adaptive), '--overwrite'], check=True)
        subprocess.run([str(CLI), str(adaptive), str(staged_assets / 'room.sog'), '--overwrite'], check=True)
        # Surface geometry remains based on the full source, independent of visual density.
        subprocess.run([str(CLI), str(source), str(staged_assets / 'surface.voxel.json'), *SETTINGS['surfaceArguments'], '--overwrite'], check=True)
        for name in OUTPUTS:
            if not (staged_assets / name).is_file() or not (staged_assets / name).stat().st_size:
                raise RuntimeError(f'Conversion did not produce a nonempty {name}; existing assets were preserved.')
        (staged_assets / 'preparation.json').write_text(json.dumps({
            'archiveSha256': archive_hash,
            'sourceSha256': digest(source),
            'licenseSha256': digest(staged_license),
            'tool': version,
            'settings': SETTINGS,
            'calibration': 'synthetic_demo',
            'outputs': {name: {'sha256': digest(staged_assets / name), 'bytes': (staged_assets / name).stat().st_size} for name in OUTPUTS},
        }, indent=2) + '\n')
        publish(staged_assets, staged_license)
    print('Ready. Run ./run-local.sh and open the frontend URL. Scale remains an explicit test assumption.')


if __name__ == '__main__':
    main()
