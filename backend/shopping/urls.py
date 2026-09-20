from django.urls import path
from . import views

urlpatterns = [path('', views.detail), path('confirm-placement/', views.confirm),
    path('items/<uuid:item_id>/', views.remove), path('claim/', views.claim), path('checkout/', views.checkout)]
