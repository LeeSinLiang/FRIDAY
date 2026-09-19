from django.urls import include, path
from .views import health
from .scene_views import scene, scene_commands, scene_placement, captures, capture_claim, capture_complete, capture_detail, capture_image

urlpatterns = [
    path('health/', health, name='health'),
    path('scene/', scene, name='scene'),
    path('scene/commands/', scene_commands, name='scene-commands'),
    path('scene/placement/', scene_placement, name='scene-placement'),
    path('scene/captures/', captures, name='captures'),
    path('scene/captures/claim/', capture_claim, name='capture-claim'),
    path('scene/captures/<uuid:capture_id>/', capture_detail, name='capture-detail'),
    path('scene/captures/<uuid:capture_id>/complete/', capture_complete, name='capture-complete'),
    path('scene/captures/<uuid:capture_id>/image/', capture_image, name='capture-image'),
    path("", include("catalogue.urls")),
]
