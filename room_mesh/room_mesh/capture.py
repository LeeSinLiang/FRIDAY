"""Bounded video sampling and an optional VGGT adapter."""
from contextlib import nullcontext
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def extract(video: Path, output: Path, max_frames=24, min_sharpness=20.0):
    if max_frames < 2 or not np.isfinite(min_sharpness) or min_sharpness < 0:
        raise ValueError("Use at least two frames and a nonnegative sharpness threshold")
    if not video.is_file():
        raise ValueError(f"Video does not exist: {video}")
    output.mkdir(parents=True, exist_ok=False)
    cap = cv2.VideoCapture(str(video))
    try:
        count, fps = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)), cap.get(cv2.CAP_PROP_FPS)
        if not cap.isOpened() or count < 2 or not np.isfinite(fps) or fps <= 0:
            raise ValueError("Cannot decode video or read its duration/frame rate")
        # Spread candidates across the WHOLE clip, not just its first seconds.
        candidates = np.unique(np.linspace(0, count - 1, min(count, max_frames * 3)).astype(int))
        records = []
        for index in candidates:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(index))
            ok, bgr = cap.read()
            if not ok:
                continue
            h, w = bgr.shape[:2]
            small = cv2.resize(bgr, (max(1, round(w * min(1, 640 / w))),
                                     max(1, round(h * min(1, 640 / w)))))
            sharpness = float(cv2.Laplacian(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
            if sharpness >= min_sharpness:
                records.append((int(index), sharpness))
        if len(records) < 2:
            raise ValueError("Fewer than two sharp frames; improve lighting/motion or lower --min-sharpness")
        selected = [records[i] for i in np.unique(np.linspace(0, len(records)-1, min(max_frames, len(records))).astype(int))]
        manifest = []
        for sequence, (index, sharpness) in enumerate(selected):
            cap.set(cv2.CAP_PROP_POS_FRAMES, index)
            ok, bgr = cap.read()
            if not ok:
                raise ValueError(f"Failed to reread selected video frame {index}")
            # Bound decoded image storage; VGGT subsequently preprocesses to 518 px.
            h, w = bgr.shape[:2]
            ratio = min(1, 1920 / max(h, w))
            bgr = cv2.resize(bgr, (round(w * ratio), round(h * ratio)))
            name = f"{sequence:04d}.png"
            if not cv2.imwrite(str(output / name), bgr):
                raise OSError(f"Could not write {name}")
            manifest.append(dict(file=name, video_frame=index, seconds=index/fps, sharpness=sharpness))
        (output / "frames.json").write_text(json.dumps(manifest, indent=2) + "\n")
        return [output / record['file'] for record in manifest]
    finally:
        cap.release()


def infer(frames: list[Path], output: Path, model_id: str, device: str):
    # Import only on this path: cached reconstruction and tests need no ML stack.
    try:
        import torch
        from vggt.models.vggt import VGGT
        from vggt.utils.load_fn import load_and_preprocess_images
        from vggt.utils.pose_enc import pose_encoding_to_extri_intri
    except ImportError as error:
        raise RuntimeError('Install inference dependencies: uv pip install -e ".[inference]"') from error
    if len(frames) < 2:
        raise ValueError("At least two frames are required")
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA requested but not available")
    if device == "mps" and not torch.backends.mps.is_available():
        raise ValueError("MPS requested but not available")
    print(f"Loading {model_id} on {device}; first use downloads weights", flush=True)
    model = VGGT.from_pretrained(model_id).eval().to(device)
    images = load_and_preprocess_images([str(p) for p in frames]).to(device)
    context = nullcontext()
    if device == "cuda":
        dtype = torch.bfloat16 if torch.cuda.get_device_capability()[0] >= 8 else torch.float16
        context = torch.autocast(device_type="cuda", dtype=dtype)
    # Keep all views in one forward pass: independent chunks have unrelated scales/poses.
    with torch.inference_mode(), context:
        prediction = model(images)
        extrinsic, intrinsic = pose_encoding_to_extri_intri(prediction["pose_enc"], images.shape[-2:])
    cpu = lambda tensor: tensor.detach().float().cpu().numpy()
    rgb = np.clip(cpu(images).transpose(0, 2, 3, 1) * 255, 0, 255).astype(np.uint8)
    output.mkdir(parents=True, exist_ok=False)
    np.savez_compressed(output / "prediction.npz", images=rgb,
                        depth=cpu(prediction['depth'])[0, ..., 0],
                        confidence=cpu(prediction['depth_conf'])[0],
                        extrinsics=cpu(extrinsic)[0], intrinsics=cpu(intrinsic)[0])
    for i, image in enumerate(rgb):
        Image.fromarray(image).save(output / f"view-{i:04d}.png")
    (output / "source.json").write_text(json.dumps(dict(model=model_id, device=device,
        frames=[str(p.resolve()) for p in frames], coordinate_convention="OpenCV world-to-camera"), indent=2) + "\n")
    return output / "prediction.npz"
