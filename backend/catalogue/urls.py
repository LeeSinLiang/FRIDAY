from django.urls import re_path

from .views import search

# Optional trailing slash: the repo's routes use one, the documented search URL does not.
urlpatterns = [re_path(r"^search/?$", search, name="search")]
