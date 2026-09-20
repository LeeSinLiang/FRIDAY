import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR.parent / ".env")

DEBUG = os.getenv("DJANGO_DEBUG", "true").lower() == "true"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY when DJANGO_DEBUG=false.")
    SECRET_KEY = "django-insecure-local-development-only-not-for-deployment"
ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]").split(",")
    if host.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "api",
    "visa",
    "allauth",
    "allauth.account",
    "allauth.headless",
    "allauth.mfa",
    "accounts",
    "checkout",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "accounts.middleware.AccountSecurityMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"
# One SQLite file serves three unrelated writers: scene saves on every placement, the cache table
# behind throttles and rate limits, and sessions, accounts and MFA. With SQLite's defaults they
# fight over one lock and the loser gets "database is locked" at once, which the scene API turns
# into a 503.
#   transaction_mode IMMEDIATE  Take the write lock at BEGIN. A deferred transaction that reads and
#                               then writes fails INSTANTLY on contention, ignoring the timeout,
#                               because SQLite will not let it upgrade its lock. This is the fix.
#   journal_mode WAL            Readers never block the writer, nor the writer them.
#   timeout 20                  How long a writer queues for the lock before giving up.
#   synchronous NORMAL          Safe with WAL; one fsync per checkpoint instead of per commit.
DATABASES = {"default": {
    "ENGINE": "django.db.backends.sqlite3",
    "NAME": BASE_DIR / "db.sqlite3",
    "OPTIONS": {
        "transaction_mode": "IMMEDIATE",
        "timeout": 20,
        "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
    },
}}
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": f"django.contrib.auth.password_validation.{name}"}
    for name in [
        "UserAttributeSimilarityValidator", "MinimumLengthValidator",
        "CommonPasswordValidator", "NumericPasswordValidator",
    ]
]
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
}

# The developer harness is opt-in, loopback-only, and unavailable outside DEBUG.
VISA_SANDBOX_TESTER_ENABLED = os.getenv("VISA_SANDBOX_TESTER_ENABLED", "false").lower() == "true"
VISA_SANDBOX_CREDENTIALS_FILE = os.getenv("VISA_SANDBOX_CREDENTIALS_FILE", "")
if DEBUG:
    _frontend_port = int(os.getenv("FRONTEND_PORT", "5173"))
    CSRF_TRUSTED_ORIGINS = [f"http://127.0.0.1:{_frontend_port}", f"http://localhost:{_frontend_port}"]

AUTHENTICATION_BACKENDS = ["allauth.account.auth_backends.AuthenticationBackend"]
HEADLESS_ONLY = True
HEADLESS_CLIENTS = ("browser",)
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*", "password2*"]
ACCOUNT_EMAIL_VERIFICATION = "mandatory"
ACCOUNT_EMAIL_VERIFICATION_BY_CODE_ENABLED = True
ACCOUNT_EMAIL_VERIFICATION_SUPPORTS_RESEND = True
ACCOUNT_EMAIL_VERIFICATION_BY_CODE_TIMEOUT = 600
ACCOUNT_REAUTHENTICATION_REQUIRED = True
ACCOUNT_SESSION_REMEMBER = False
MFA_SUPPORTED_TYPES = ["totp", "recovery_codes"]
MFA_RECOVERY_CODES_SHOW_ONCE = True
MFA_TOTP_ISSUER = "FRIDAY"
MFA_ADAPTER = "accounts.adapters.EncryptedMFAAdapter"
MFA_ENCRYPTION_KEY_FILE = Path(os.getenv("MFA_ENCRYPTION_KEY_FILE", str(BASE_DIR / ".runtime/mfa.key")))
_frontend_origin = os.getenv("FRONTEND_ORIGIN", f"http://127.0.0.1:{os.getenv('FRONTEND_PORT', '5173')}").rstrip("/")
HEADLESS_FRONTEND_URLS = {
    "account_confirm_email": _frontend_origin + "/account?verify={key}",
    "account_reset_password": _frontend_origin + "/account?mode=reset",
    "account_reset_password_from_key": _frontend_origin + "/account?reset={key}",
    "account_signup": _frontend_origin + "/account",
}
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "FRIDAY <noreply@friday.local>")
AUTH_LOCAL_INBOX_ENABLED = DEBUG and os.getenv("AUTH_LOCAL_INBOX_ENABLED", "true").lower() == "true"
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "accounts.email_backend.LocalInboxBackend" if DEBUG else "django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "true").lower() == "true"
EMAIL_TIMEOUT = 15
# Shared by local reload workers/processes; createcachetable is part of setup.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "friday_cache"}}
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
if not DEBUG and (not EMAIL_HOST or not os.getenv("MFA_ENCRYPTION_KEY_FILE")):
    raise ImproperlyConfigured("Configure EMAIL_HOST and MFA_ENCRYPTION_KEY_FILE for deployment.")
