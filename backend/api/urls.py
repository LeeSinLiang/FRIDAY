from django.urls import include, path
from .views import health
from .designer_intent import intent
from .designer_views import designer, designer_poll, variants, variants_poll, variants_refine
from .scene_views import scene, scene_commands, scene_placement, captures, capture_claim, capture_complete, capture_detail, capture_image

urlpatterns = [
    path('health/', health, name='health'),
    path('scene/', scene, name='scene'),
    path('designer/', designer, name='scene-designer'),
    path('designer/intent/', intent, name='designer-intent'),
    path('designer/variants/', variants, name='scene-variants'),
    path('designer/variants/<uuid:job_id>/', variants_poll, name='scene-variants-poll'),
    path('designer/variants/<uuid:job_id>/refine/', variants_refine, name='scene-variants-refine'),
    path('designer/<uuid:job_id>/', designer_poll, name='scene-designer-poll'),
    path('scene/commands/', scene_commands, name='scene-commands'),
    path('scene/placement/', scene_placement, name='scene-placement'),
    path('scene/captures/', captures, name='captures'),
    path('scene/captures/claim/', capture_claim, name='capture-claim'),
    path('scene/captures/<uuid:capture_id>/', capture_detail, name='capture-detail'),
    path('scene/captures/<uuid:capture_id>/complete/', capture_complete, name='capture-complete'),
    path('scene/captures/<uuid:capture_id>/image/', capture_image, name='capture-image'),
    path("", include("catalogue.urls")),
]
