from django.urls import re_path

from .views import compile_program, search, transcribe_audio
from .speak import speak

# Optional trailing slash: the repo's routes use one, the documented URLs do not.
# POST needs both spelled out, since Django cannot redirect a POST to add the slash.
urlpatterns = [
    re_path(r"^search/?$", search, name="search"),
    re_path(r"^compile/?$", compile_program, name="compile"),
    re_path(r"^transcribe/?$", transcribe_audio, name="transcribe"),
    re_path(r"^speak/?$", speak, name="speak"),
]
