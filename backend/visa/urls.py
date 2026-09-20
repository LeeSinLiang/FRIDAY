from django.urls import path
from . import views

app_name = "visa"
urlpatterns = [
    path("sandbox-test/", views.test_page, name="test-page"),
    path("sandbox-test/bootstrap/", views.bootstrap, name="bootstrap"),
    path("sandbox-test/validate/", views.validate, name="validate"),
    path("sandbox-test/submit/", views.submit, name="submit"),
    path("sandbox-test/attempts/<uuid:attempt_id>/", views.result, name="result"),
]
