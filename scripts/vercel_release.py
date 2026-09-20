"""Explicit release helpers. Run with backend/.venv/bin/python; never prints secrets."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    migrate = commands.add_parser('migrate', help='Apply schema and cache table using a private environment file')
    migrate.add_argument('--env-file', type=Path, required=True)
    config = commands.add_parser('frontend-config', help='Generate a frontend configuration pinned to its matching API deployment')
    config.add_argument('--backend-origin', required=True)
    config.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'migrate':
        from dotenv import dotenv_values
        values = dotenv_values(args.env_file)
        if not values.get('DATABASE_URL', '').startswith(('postgres://', 'postgresql://')):
            parser.error('A Postgres DATABASE_URL is required; local databases are never uploaded.')
        # Vercel Secret variables pull as redacted placeholders. Schema changes
        # need the database only, not SMTP, Visa or the application's MFA key.
        # Use management-only settings; these never become deployment variables.
        environment = {**os.environ, 'DATABASE_URL':values['DATABASE_URL'], 'DJANGO_DEBUG':'true',
                       'EMAIL_BACKEND':'django.core.mail.backends.locmem.EmailBackend', 'EMAIL_PORT':'587'}
        for command in [('migrate', '--noinput'), ('createcachetable',)]:
            subprocess.run([str(ROOT/'backend/.venv/bin/python'), 'manage.py', *command],
                           cwd=ROOT/'backend', env=environment, check=True)
    else:
        url = urlparse(args.backend_origin)
        if url.scheme != 'https' or not url.netloc or url.path not in ('', '/') or url.username or url.query or url.fragment:
            parser.error('Use a plain HTTPS backend origin without credentials, path or query.')
        value = json.loads((ROOT/'frontend/vercel.json').read_text())
        for rewrite in value['rewrites']:
            if rewrite['source'].startswith(('/api/', '/_allauth/')):
                rewrite['destination'] = args.backend_origin.rstrip('/') + rewrite['source']
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(value, indent=2)+'\n')
        print('Wrote frontend configuration pinned to '+url.hostname)


if __name__ == '__main__':
    main()
