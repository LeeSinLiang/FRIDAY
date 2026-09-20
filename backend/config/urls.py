from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("api/cart/", include("shopping.urls")),
    path("_allauth/", include("allauth.headless.urls")),
    path("accounts/", include("allauth.urls")),
    path("api/accounts/", include("accounts.urls")),
    path("api/checkouts/", include("checkout.urls")),
    path("admin/", admin.site.urls),
    path("api/", include("api.urls")),
    path("api/visa/", include("visa.urls")),
]
