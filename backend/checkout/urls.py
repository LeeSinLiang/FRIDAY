from django.urls import path
from . import views

urlpatterns = [path("", views.create), path("catalogue/", views.catalogue_view),
    path("<uuid:checkout_id>/", views.detail), path("<uuid:checkout_id>/approve/", views.approve),
    path("<uuid:checkout_id>/submit/", views.submit)]
