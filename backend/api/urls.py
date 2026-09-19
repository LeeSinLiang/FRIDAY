from django.urls import path
from .views import health
from .scene_views import scene, scene_commands

urlpatterns = [
    path('health/', health, name='health'),
    path('scene/', scene, name='scene'),
    path('scene/commands/', scene_commands, name='scene-commands'),
]
