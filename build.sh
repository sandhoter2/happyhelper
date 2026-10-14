#!/usr/bin/env bash
# build.sh — runs on every container start (cold start, Render wake from hibernation)
# collectstatic is done once at Docker image build time — NOT repeated here.
set -o errexit

# ── 1. Migrate ────────────────────────────────────────────────────────────────
echo ">>> Migrating ..."
python manage.py migrate --no-input

# ── 2. Superuser + seeds in one Python process (avoids repeated Django startup) ─
echo ">>> Startup init ..."
python - <<'PYINIT'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "happyhelper.settings")
django.setup()

from django.contrib.auth.models import User
from interview.models import PromptTemplate, Task
from django.core.management import call_command

# ── Superuser ─────────────────────────────────────────────────────────────────
username = os.environ.get("DJANGO_SUPERUSER_USERNAME", "superadmin")
password = os.environ.get("DJANGO_SUPERUSER_PASSWORD", "")
email    = os.environ.get("DJANGO_SUPERUSER_EMAIL", "")
if password:
    u, created = User.objects.get_or_create(username=username)
    u.set_password(password)
    u.is_staff = u.is_superuser = True
    if email:
        u.email = email
    u.save()
    print(f"    Superuser '{username}' {'created' if created else 'updated'}.")

# ── Templates — 2 queries instead of N+1 ─────────────────────────────────────
# Build set difference in Python; call seeder only when at least one user lacks templates.
seeded_ids = set(PromptTemplate.objects.values_list('owner_id', flat=True).distinct())
all_ids    = set(User.objects.values_list('id', flat=True))
if all_ids - seeded_ids:
    call_command('seed_templates', verbosity=1)
else:
    print("    Templates already seeded — skipping.")

# ── Tasks — single EXISTS check ───────────────────────────────────────────────
if Task.objects.exists():
    print("    Tasks already seeded — skipping.")
else:
    call_command('seed_tasks', verbosity=1)

print("    Done.")
PYINIT
