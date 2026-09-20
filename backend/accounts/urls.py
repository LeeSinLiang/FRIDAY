from django.urls import path
from . import views

urlpatterns = [path("status/", views.status), path("local-inbox/", views.inbox),
               path("recovery/acknowledge/", views.acknowledge_recovery),
               path("email/confirm/", views.confirm_email), path("totp-qr/", views.totp_qr)]
