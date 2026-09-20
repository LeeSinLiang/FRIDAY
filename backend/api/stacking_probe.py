"""Offline cross-language placement probe used by the frontend agreement test."""
import json
import os
import sys
from unittest.mock import patch

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django  # noqa: E402
django.setup()

from api.catalogue_products import catalogue_product  # noqa: E402
from api.scene_service import SceneError, validate_instances  # noqa: E402


def main():
    table = catalogue_product('ikea-702.211.42')
    vase = catalogue_product('abo-B07B8NVHX1')
    results = []
    for case in json.load(sys.stdin):
        room = {'roomId': 'comparison', 'revision': 1, 'widthCm': 600, 'depthCm': 500, 'heightCm': case['roomHeightCm']}
        table_instance = {'instanceId': 'table-1', 'productId': table['productId'], 'product': table,
                          'pose': {'xCm': 300, 'zCm': 250, 'yawRad': case['tableYawRad']}}
        vase_instance = {'instanceId': 'vase-1', 'productId': vase['productId'], 'product': vase,
                         'pose': {'xCm': case['xCm'], 'zCm': case['zCm'], 'yawRad': case['yawRad']}}
        instances = [vase_instance, table_instance] if case['reverse'] else [table_instance, vase_instance]
        try:
            with patch('api.scene_service.room_context', return_value={'room': room, 'products': []}):
                validate_instances(instances)
            results.append(True)
        except SceneError:
            results.append(False)
    print(json.dumps(results))


if __name__ == '__main__':
    main()
