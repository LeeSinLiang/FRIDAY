"""Content identity of tracked/trackable runtime sources, including uncommitted work."""
import hashlib
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def identity():
    names = subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT).decode().split('\0')
    digest = hashlib.sha256()
    for name in sorted(set(names)):
        if not name.startswith(('backend/','frontend/','shared/','scripts/')):
            continue
        path = ROOT/name
        if path.is_file():
            digest.update(name.encode()+b'\0'+path.read_bytes()+b'\0')
    return digest.hexdigest()


if __name__ == '__main__':
    print(identity())
