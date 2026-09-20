# Load the shared Cg Arch room

Use the current mesh checkpoint on main. Python 3.9+ is sufficient; Blender and baking are not needed on the receiving laptop.

1. Obtain `friday-cg-arch-room.zip` and its SHA-256 from the teammate who prepared it.
2. From the repository root, run:

   ```bash
   ./scripts/import-room.sh ~/Downloads/friday-cg-arch-room.zip --sha256 <sender-checksum>
   ```

   The checksum flag is optional but checks the complete download against the sender's separate checksum. Per-file checks are always performed; they detect corruption, not an untrusted sender.
3. Restart `./run-local.sh` and open `http://127.0.0.1:<your-frontend-port>/?room=cg-arch-interior`.

The ZIP contains the prepared GLB, manifest, reviewed spatial geometry and attribution. The importer installs only the GLB under `shared/rooms/cg-arch-interior/assets/room.glb`; checked-in metadata must match exactly. If metadata differs, obtain the matching repository checkpoint/package. An identical existing GLB is a no-op; a different existing GLB must be explicitly backed up and moved aside. Saved layouts are untouched.

## Prepare the package

On the laptop containing the prepared room:

```bash
mkdir -p .room-preparation/sharing
python3 scripts/room_bundle.py pack .room-preparation/sharing/friday-cg-arch-room.zip
```

The command prints the ZIP checksum and refuses to overwrite an existing archive. Share the ZIP and checksum through the team's chosen private file-sharing channel; no upload is automatic. Packages and room binaries stay ignored by Git. Keep the included Blendkit attribution and comply with its Royalty Free terms; this workflow does not grant new redistribution rights or authorize a public asset mirror.

This shares the current appearance, including known lighting/trim artifacts. It does not rebake, improve the room, or turn the reviewed placement rectangle into full-room collision geometry.

## Verification

```bash
python3 -m unittest discover -s scripts -p 'test_room_bundle.py'
```
