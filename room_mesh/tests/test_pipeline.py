import json
from pathlib import Path
import tempfile
import unittest

import cv2
import numpy as np
import trimesh

from room_mesh.capture import extract
from room_mesh.demo import fixture
from room_mesh.geometry import calibration, load_prediction, project, unproject
from room_mesh.surface import build, texture_scene


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.prediction,self.cal = fixture(self.root/'input')
        self.data = load_prediction(self.prediction)

    def test_metric_scale_and_floor_alignment(self):
        config = json.loads(self.cal.read_text())
        config['reference']['distance_m'] = 2.4
        self.cal.write_text(json.dumps(config))
        scale,transform,meta = calibration(self.data,self.cal)
        self.assertAlmostEqual(scale,2.)
        self.assertTrue(meta['floor_alignment_supplied'])
        np.testing.assert_allclose(transform @ [0,1,0,1],[0,0,0,1],atol=1e-7)
        np.testing.assert_allclose(transform @ [0,0,0,1],[0,2,0,1],atol=1e-7)
        self.assertGreater(np.linalg.det(transform[:3,:3]),0)

    def test_camera_convention_roundtrip(self):
        for i in range(3):
            point = unproject(self.data,i,[50,40])
            uv,z = project(point[None],self.data['extrinsics'][i],self.data['intrinsics'][i])
            np.testing.assert_allclose(uv[0],[50,40],atol=1e-7)
            self.assertGreater(z[0],0)

    def test_calibration_rejects_degenerate_reference(self):
        config = json.loads(self.cal.read_text())
        config['reference']['points'][1] = config['reference']['points'][0]
        self.cal.write_text(json.dumps(config))
        with self.assertRaisesRegex(ValueError,'distinct'):
            calibration(self.data,self.cal)
        with self.assertRaisesRegex(ValueError,'outside'):
            unproject(self.data,0,[-1,0])

    def test_fail_closed_on_missing_metric_calibration(self):
        with self.assertRaisesRegex(ValueError,'requires --calibration'):
            build(self.prediction,self.root/'output',None)
        self.assertFalse((self.root/'output').exists())

    def test_invalid_camera_is_rejected(self):
        self.data['extrinsics'][0,0,0] = 2
        np.savez(self.root/'bad.npz',**self.data)
        with self.assertRaisesRegex(ValueError,'rigid'):
            load_prediction(self.root/'bad.npz')

    def test_full_fusion_texture_collision_export(self):
        output = self.root/'mesh'
        report = build(self.prediction,output,self.cal,voxel_size=.06,collision_triangles=500)
        self.assertEqual(report['units'],'meters')
        self.assertGreater(report['visual_triangles'],500)
        self.assertLessEqual(report['collision_triangles'],500)
        self.assertGreater(report['texture_coverage_fraction'],.5)
        self.assertFalse(report['spatial_validation_ready'])
        visual = trimesh.load(output/'room.glb',force='scene')
        collider = trimesh.load(output/'collision.glb',force='mesh')
        self.assertTrue(np.isfinite(collider.vertices).all())
        np.testing.assert_allclose(visual.bounds,collider.bounds,atol=.08)
        self.assertAlmostEqual(visual.bounds[0,1],0.,delta=.08)
        self.assertAlmostEqual(visual.bounds[0,2],-3.,delta=.08)
        self.assertTrue(any(g.visual.kind == 'texture' for g in visual.geometry.values()))
        for geometry in visual.geometry.values():
            if geometry.visual.kind == 'texture':
                self.assertTrue(np.isfinite(geometry.visual.uv).all())
                self.assertGreaterEqual(geometry.visual.uv.min(),0)
                self.assertLessEqual(geometry.visual.uv.max(),1)
                self.assertIsNotNone(geometry.visual.material.baseColorTexture)
        camera = np.load(output/'cameras.npz')
        exported = (camera['native_to_output'] @ [0,0,3,1])[:3]
        xyz = (camera['world_to_camera'][1] @ np.r_[exported,1])[:3]
        np.testing.assert_allclose(xyz,[0,0,3],atol=1e-7)
        self.assertEqual(json.loads((output/'manifest.json').read_text())['status'],'complete')
        with self.assertRaises(FileExistsError):
            build(self.prediction,output,self.cal)

    def test_empty_depth_does_not_produce_success(self):
        self.data['depth'][:] = np.nan
        np.savez(self.root/'empty.npz',**self.data)
        with self.assertRaisesRegex(ValueError,'no surfaces'):
            build(self.root/'empty.npz',self.root/'empty-output',None,allow_unscaled=True)
        self.assertFalse((self.root/'empty-output'/'manifest.json').exists())

    def test_occluded_triangle_has_no_photo_texture(self):
        import open3d as o3d
        mesh = o3d.geometry.TriangleMesh()
        mesh.vertices = o3d.utility.Vector3dVector([[-.2,-.2,4.],[.2,-.2,4.],[0,.2,4.]])
        mesh.triangles = o3d.utility.Vector3iVector([[0,1,2]])
        mesh.paint_uniform_color([.5,.5,.5])
        scene,atlas,fraction = texture_scene(mesh,self.data,1.,.05)
        self.assertEqual(fraction,0.)
        self.assertIn('room_fused_color',scene.geometry)

    def test_unscaled_export_remains_explicit(self):
        report = build(self.prediction,self.root/'unscaled',None,allow_unscaled=True,voxel_size=.1)
        self.assertEqual(report['units'],'arbitrary')
        self.assertIsNone(report['scale_m_per_native_unit'])
        self.assertFalse(report['floor_alignment_supplied'])

    def test_video_sampling_spans_clip_and_preserves_rgb(self):
        video = self.root/'test.avi'
        writer = cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*'MJPG'),10.,(128,96))
        self.assertTrue(writer.isOpened())
        for i in range(30):
            frame = np.zeros((96,128,3),dtype=np.uint8)
            frame[:] = [20,40,180]
            cv2.putText(frame,str(i),(10,60),cv2.FONT_HERSHEY_SIMPLEX,1.,(255,255,255),2)
            writer.write(frame)
        writer.release()
        frames = extract(video,self.root/'frames',max_frames=5,min_sharpness=0)
        self.assertEqual(len(frames),5)
        manifest = json.loads((self.root/'frames'/'frames.json').read_text())
        self.assertEqual(manifest[0]['video_frame'],0)
        self.assertEqual(manifest[-1]['video_frame'],29)
        from PIL import Image
        rgb = np.asarray(Image.open(frames[0]))[0,0]
        self.assertGreater(rgb[0],rgb[2]+100)

    def test_vggt_adapter_with_real_preprocessing_and_stub_predictions(self):
        # Checks the adapter boundary without downloading weights or claiming inference quality.
        import importlib.util
        if not importlib.util.find_spec('vggt') or not importlib.util.find_spec('torch'):
            self.skipTest('Optional inference dependencies are not installed')
        import torch
        from unittest.mock import patch
        from vggt.utils.pose_enc import extri_intri_to_pose_encoding
        from room_mesh.capture import infer

        class StubModel:
            def eval(self):
                return self

            def to(self, device):
                return self

            def __call__(self, images):
                n,_,h,w = images.shape
                e = torch.eye(4)[:3].repeat(1,n,1,1)
                k = torch.tensor([[400.,0,w/2],[0,400.,h/2],[0,0,1.]]).repeat(1,n,1,1)
                return dict(pose_enc=extri_intri_to_pose_encoding(e,k,(h,w)),
                    depth=torch.ones((1,n,h,w,1))*3,depth_conf=torch.ones((1,n,h,w))*10)

        with patch('vggt.models.vggt.VGGT.from_pretrained', return_value=StubModel()):
            path = infer(sorted((self.root/'input').glob('view-*.png')),self.root/'adapter','test-stub','cpu')
        data = load_prediction(path)
        self.assertEqual(data['images'].shape,(3,392,518,3))
        self.assertEqual(data['depth'].shape,(3,392,518))
        np.testing.assert_allclose(data['intrinsics'][:,0,0],400.,atol=.001)
        np.testing.assert_allclose(data['extrinsics'][0],np.eye(4)[:3],atol=1e-6)


if __name__ == '__main__':
    unittest.main()
