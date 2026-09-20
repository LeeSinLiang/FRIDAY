#!/usr/bin/env python3
"""Stand a furniture GLB on the floor at its listing's size.

Usage:
  python3 scripts/fit_glb.py <model.glb> <height_cm>                        uniform scale (the default)
  python3 scripts/fit_glb.py <model.glb> <width_cm> <depth_cm> <height_cm>  per axis, capped at 10% anisotropy

For generated assets that arrive normalised to a unit cube, or with proportions a few percent off.
Lossless, and safe to run again: a second fit replaces the first. The per-axis form never stretches
past the cap. If the listing cannot be reached inside it, the closest fit is applied and the miss is
printed; a miss outside the asset check's tolerance means the model is a different object from the
listing and should stay unbound (model_url null, an "unbound" reason in metadata.json).

Exit codes: 0 fitted and inside the asset tolerance, 1 fitted but still outside it, 2 bad arguments.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from api.glb import fit_to_box, fit_to_height, measure  # noqa: E402

TOLERANCE_CM, TOLERANCE_RATIO = 2.0, 0.03  # the same rule as backend/api/test_furniture_assets.py


def box(measured: dict) -> str:
    width, height, depth = (100 * value for value in measured["size"])
    return f"{width:.1f} x {depth:.1f} x {height:.1f} cm (w x d x h), y from {100 * measured['min'][1]:.1f} cm"


def fit_uniform(path: Path, height_cm: float) -> int:
    applied = fit_to_height(path, height_cm / 100)
    print(f"scale {applied['scale']:.4f}, lift {applied['translation'][1]:.4f} m")
    return 0


def fit_boxed(path: Path, width_cm: float, depth_cm: float, height_cm: float) -> int:
    target_cm = (width_cm, height_cm, depth_cm)  # glTF order: X width, Y up, Z depth
    applied = fit_to_box(path, [value / 100 for value in target_cm])
    print("scale x/y/z " + " / ".join(f"{value:.4f}" for value in applied["scale"])
          + f", anisotropy {100 * applied['anisotropy']:.2f}%")
    print("residual cm (w, h, d): " + ", ".join(f"{value:+.2f}" for value in applied["residual_cm"]))
    outside = [abs(miss) > max(TOLERANCE_CM, TOLERANCE_RATIO * target)
               for miss, target in zip(applied["residual_cm"], target_cm)]
    if any(outside):
        print("STILL OUTSIDE the asset tolerance at the cap: leave this model unbound", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str]) -> int:
    if len(argv) not in (3, 5):
        print(__doc__, file=sys.stderr)
        return 2
    try:
        path, numbers = Path(argv[1]), [float(value) for value in argv[2:]]
    except ValueError:
        print(__doc__, file=sys.stderr)
        return 2
    print(f"before: {box(measure(path))}")
    code = fit_uniform(path, *numbers) if len(numbers) == 1 else fit_boxed(path, *numbers)
    print(f"after:  {box(measure(path))}")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
