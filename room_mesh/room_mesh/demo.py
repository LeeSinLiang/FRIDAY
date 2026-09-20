"""Analytic multi-view room fixture; explicitly NOT learned/video reconstruction."""
import json
from pathlib import Path

import numpy as np
from PIL import Image


def fixture(output: Path):
    output.mkdir(parents=True,exist_ok=False)
    h,w = 96,128
    k = np.array([[95.,0,w/2],[0,95.,h/2],[0,0,1.]])
    yy,xx = np.mgrid[:h,:w]
    rays = np.stack([(xx-w/2)/95.,(yy-h/2)/95.,np.ones((h,w))],axis=-1)
    images, depths, extrinsics = [], [], []
    # Native OpenCV: camera y down. Floor y=1, back wall z=3, side walls x=+-2.
    for camera_x in (-.25,0.,.25):
        center = np.array([camera_x,0.,0.])
        candidates = []
        for axis,coordinate in ((2,3.),(1,1.),(0,-2.),(0,2.)):
            with np.errstate(divide='ignore',invalid='ignore'):
                distance = (coordinate-center[axis])/rays[:,:,axis]
            candidates.append(np.where(distance>0,distance,np.inf))
        depth = np.min(candidates,axis=0).astype(np.float32)
        points = center + rays*depth[:,:,None]
        checker = ((np.floor(points[:,:,0]*4)+np.floor(points[:,:,1]*4)+np.floor(points[:,:,2]*4)).astype(int)%2)
        rgb = np.zeros((h,w,3),dtype=np.uint8)
        rgb[:] = [170,190,215]
        rgb[checker==0] = [85,110,140]
        extrinsic = np.column_stack([np.eye(3),-center])
        images.append(rgb); depths.append(depth); extrinsics.append(extrinsic)
    np.savez_compressed(output/'prediction.npz', images=np.array(images),depth=np.array(depths),
        confidence=np.ones((3,h,w),dtype=np.float32)*10,
        intrinsics=np.repeat(k[None],3,axis=0),extrinsics=np.array(extrinsics))
    for i,rgb in enumerate(images):
        Image.fromarray(rgb).save(output/f'view-{i:04d}.png')
    calibration = dict(reference=dict(distance_m=1.2,
        points=[dict(frame=1,pixel=[45,48]),dict(frame=1,pixel=[83,48])]),
        up=[0,-1,0],origin=[0,1,0])
    (output/'calibration.json').write_text(json.dumps(calibration,indent=2)+'\n')
    (output/'source.json').write_text(json.dumps(dict(source='synthetic analytic room; no model inference'))+'\n')
    return output/'prediction.npz',output/'calibration.json'
