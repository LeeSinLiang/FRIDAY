"""Explicit release helpers. Run with backend/.venv/bin/python; never prints secrets."""
import argparse
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    migrate = commands.add_parser('migrate', help='Apply schema and cache table using a private environment file')
    migrate.add_argument('--env-file', type=Path, required=True)
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


if __name__ == '__main__':
    main()
