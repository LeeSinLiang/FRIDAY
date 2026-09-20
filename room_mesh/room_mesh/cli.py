import argparse
import json
from pathlib import Path
import sys


def parser():
    p = argparse.ArgumentParser(description='Standalone video → calibrated textured mesh. See docs/reconstruction/video-to-mesh.md.')
    commands = p.add_subparsers(dest='command', required=True)
    extract = commands.add_parser('extract',help='Sample sharp frames across a video')
    extract.add_argument('video',type=Path)
    extract.add_argument('--output',required=True,type=Path)
    extract.add_argument('--max-frames',type=int,default=24)
    extract.add_argument('--min-sharpness',type=float,default=20.)
    infer = commands.add_parser('infer',help='Estimate cameras/depth with VGGT; saves inspectable views and NPZ')
    infer.add_argument('frames',type=Path)
    infer.add_argument('--output',type=Path,required=True)
    run = commands.add_parser('run',help='Video through mesh in one command; explicit calibration needed for meters')
    run.add_argument('video',type=Path)
    run.add_argument('--output',type=Path,required=True)
    run.add_argument('--max-frames',type=int,default=24)
    run.add_argument('--min-sharpness',type=float,default=20.)
    for command in (infer,run):
        command.add_argument('--model',default='facebook/VGGT-1B')
        command.add_argument('--device',choices=['auto','cuda','mps','cpu'],default='auto')
    build = commands.add_parser('build',help='Fuse cached NPZ predictions, calibrate, texture and export GLBs')
    build.add_argument('prediction',type=Path)
    build.add_argument('--output',type=Path,required=True)
    for command in (build,run):
        command.add_argument('--calibration',type=Path)
        command.add_argument('--allow-unscaled',action='store_true')
        command.add_argument('--voxel-size',type=float,default=.025)
        command.add_argument('--max-depth',type=float,default=12.)
        command.add_argument('--confidence-percentile',type=float,default=20.)
        command.add_argument('--visual-triangles',type=int,default=150000)
        command.add_argument('--collision-triangles',type=int,default=10000)
        command.add_argument('--atlas-size',type=int,default=4096)
    demo = commands.add_parser('demo',help='Exercise mesh stages using a synthetic room, without ML weights')
    demo.add_argument('--output',type=Path,required=True)
    return p


def main():
    p = parser()
    args = p.parse_args()
    try:
        # Help works even before heavy dependencies are installed.
        if args.command == 'extract':
            from .capture import extract
            frames = extract(args.video,args.output,args.max_frames,args.min_sharpness)
            print(f'Saved {len(frames)} frames to {args.output}')
        elif args.command == 'infer':
            from .capture import infer
            frames = sorted(args.frames.glob('*.png'))
            print(infer(frames,args.output,args.model,args.device))
        elif args.command == 'demo':
            from .demo import fixture
            from .surface import build
            args.output.mkdir(parents=True,exist_ok=False)
            prediction,calibration = fixture(args.output/'synthetic')
            report = build(prediction,args.output/'mesh',calibration,voxel_size=.06,collision_triangles=500)
            print(json.dumps(report,indent=2))
        else:
            from .surface import build
            if not args.calibration and not args.allow_unscaled:
                raise ValueError('Provide --calibration, or --allow-unscaled for a preview. Use extract/infer first to select calibration pixels.')
            if args.calibration and not args.calibration.is_file():
                raise ValueError(f'Calibration file does not exist: {args.calibration}')
            if args.command == 'run':
                from .capture import extract,infer
                args.output.mkdir(parents=True,exist_ok=False)
                frames = extract(args.video,args.output/'frames',args.max_frames,args.min_sharpness)
                prediction = infer(frames,args.output/'inference',args.model,args.device)
                output = args.output/'mesh'
            else:
                prediction,output = args.prediction,args.output
            report = build(prediction,output,args.calibration,args.allow_unscaled,args.voxel_size,
                args.max_depth,args.confidence_percentile,args.visual_triangles,args.collision_triangles,args.atlas_size)
            print(json.dumps(report,indent=2))
    except (ValueError, KeyError, OSError, RuntimeError, ImportError) as error:
        print(f'room-mesh: {error}',file=sys.stderr)
        print('No successful output is established without mesh/manifest.json (or build output/manifest.json). Use a new output directory when retrying.',file=sys.stderr)
        sys.exit(1)
