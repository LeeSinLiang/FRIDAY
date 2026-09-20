import os
from pathlib import Path
from django.conf import settings


def shared_root():
    base = Path(settings.BASE_DIR)
    return base/'runtime_shared' if os.getenv('VERCEL') else base.parent/'shared'
