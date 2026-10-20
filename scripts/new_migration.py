#!/usr/bin/env python3
"""Create a new, empty migration file with a collision-free version.

    python3 scripts/new_migration.py add_widget_table      (or: npm run migration:new -- add_widget_table)

The version is the current UTC time to the second (YYYYMMDDHHMMSS), bumped forward a second
at a time if that version is already taken in supabase/migrations/. Never hand-pick a round
number like ...140000: on 2026-10-18/19/20 three separate pairs of parallel sessions did exactly
that, shipped two files with the same version, and 'Deploy migrations' failed on main each time
(see scripts/check_migration_versions.py).

If you apply SQL to production directly (e.g. via the Supabase MCP `apply_migration`), production
assigns its own version. Commit the file under THAT recorded version straight away -- read it
with: select version, name from supabase_migrations.schema_migrations order by version desc limit 1;
-- otherwise every push to main fails with "Remote migration versions not found in local
migrations directory" until someone reconciles it.

Limitation: this can only see versions already in this checkout. If another branch adds a file
with the same version, the required 'migration-filenames' check on the PR catches it.
"""
import os
import re
import sys
from datetime import datetime, timedelta, timezone

MIGRATIONS_DIR = "supabase/migrations"
DESC_RE = re.compile(r"^[a-z0-9_]+$")


def taken_versions(migrations_dir):
    versions = set()
    for fname in os.listdir(migrations_dir):
        m = re.match(r"^(\d{14})_", fname)
        if m:
            versions.add(m.group(1))
    return versions


def next_version(migrations_dir, now=None):
    now = now or datetime.now(timezone.utc)
    taken = taken_versions(migrations_dir)
    candidate = now.replace(microsecond=0)
    while candidate.strftime("%Y%m%d%H%M%S") in taken:
        candidate += timedelta(seconds=1)
    return candidate.strftime("%Y%m%d%H%M%S")


def create(description, migrations_dir=MIGRATIONS_DIR, now=None):
    description = description.strip().lower().replace("-", "_").replace(" ", "_")
    if not DESC_RE.match(description):
        raise ValueError(
            "Description may only contain letters, digits and underscores "
            f"(got {description!r})."
        )
    if not os.path.isdir(migrations_dir):
        raise FileNotFoundError(f"{migrations_dir} not found -- run from the repository root.")
    version = next_version(migrations_dir, now)
    path = os.path.join(migrations_dir, f"{version}_{description}.sql")
    with open(path, "x") as f:  # "x": refuse to overwrite, belt and braces
        f.write(f"-- {description.replace('_', ' ')}\n\n")
    return path


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    try:
        print(create(argv[1]))
    except (ValueError, FileNotFoundError) as e:
        print(f"error: {e}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
