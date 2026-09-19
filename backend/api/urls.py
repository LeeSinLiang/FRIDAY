from django.urls import include, path
from .views import health

urlpatterns = [
    path("health/", health, name="health"),
    path("", include("catalogue.urls")),
]
