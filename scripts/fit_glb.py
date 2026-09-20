#!/usr/bin/env python3
"""Stand a furniture GLB on the floor at its true height. Usage: python3 scripts/fit_glb.py <model.glb> <height_cm>

For generated assets that arrive normalised to a unit cube around the origin. Uniform scale, lossless,
and safe to run again after a re-export. Exit codes: 0 done, 2 bad arguments.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from api.glb import fit_to_height, measure  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    path, height_cm = Path(argv[1]), float(argv[2])
    before = measure(path)
    applied = fit_to_height(path, height_cm / 100)
    after = measure(path)
    box = lambda m: " x ".join(f"{100 * v:.1f}" for v in m["size"]) + f" cm, y from {100 * m['min'][1]:.1f} cm"
    print(f"before: {box(before)}\nscale {applied['scale']:.4f}, lift {applied['translation'][1]:.4f} m\nafter:  {box(after)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
