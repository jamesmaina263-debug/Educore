#!/usr/bin/env python3
"""
Checks supabase/migrations/*.sql against production's actual applied migration
history (supabase_migrations.schema_migrations), so drift like PR #43/#76/#79/#81
(a migration applied to prod under one timestamp, but committed to the repo under
a different, invented one) gets caught in CI instead of discovered weeks later.

Two checks:
  1. No two repo migration files may share the same version/timestamp prefix.
     (Supabase's migration history is one row per version string -- a collision
     is structurally broken, not just messy.)
  2. Every version in production's schema_migrations must have a matching repo
     filename, UNLESS it's listed in supabase/.migration_drift_allowlist.

A repo file with no matching prod version is NOT a failure -- that's the normal
state for a migration that's merged to main but not yet applied to production.
This check only guards the dangerous direction: prod has it, git doesn't.

Requires PROD_MIGRATIONS_JSON env var: a JSON array of {"version": ..., "name": ...}
objects, as produced by:
  psql "$SUPABASE_DB_URL" -Atqc \
    "select json_agg(json_build_object('version', version, 'name', name)) \
     from supabase_migrations.schema_migrations;"
"""
import json
import os
import re
import sys
from collections import defaultdict

MIGRATIONS_DIR = "supabase/migrations"
ALLOWLIST_PATH = "supabase/.migration_drift_allowlist"
VERSION_RE = re.compile(r"^(\d{8,14})_(.+)\.sql$")


def load_allowlist():
    if not os.path.exists(ALLOWLIST_PATH):
        return set()
    versions = set()
    with open(ALLOWLIST_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            versions.add(line)
    return versions


def load_repo_versions():
    by_version = defaultdict(list)
    for name in sorted(os.listdir(MIGRATIONS_DIR)):
        if not name.endswith(".sql"):
            continue
        m = VERSION_RE.match(name)
        if not m:
            print(f"WARNING: {name} doesn't match the expected "
                  f"<version>_<description>.sql pattern -- skipping.")
            continue
        by_version[m.group(1)].append(name)
    return by_version


def main():
    raw = os.environ.get("PROD_MIGRATIONS_JSON", "").strip()
    if not raw:
        print("PROD_MIGRATIONS_JSON is empty -- did the query step fail? Failing loudly.")
        return 1

    try:
        prod = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Could not parse PROD_MIGRATIONS_JSON as JSON: {e}")
        return 1

    prod_versions = {row["version"] for row in prod}
    repo_by_version = load_repo_versions()
    allowlist = load_allowlist()

    failed = False

    # Check 1: timestamp collisions within the repo itself.
    collisions = {v: names for v, names in repo_by_version.items() if len(names) > 1}
    if collisions:
        failed = True
        print("FAIL: multiple migration files share the same version/timestamp:")
        for v, names in sorted(collisions.items()):
            print(f"  {v}:")
            for n in names:
                print(f"    - {n}")
        print()

    # Check 2: every applied prod version has a matching repo file, or is allowlisted.
    repo_versions = set(repo_by_version.keys())
    missing = sorted(prod_versions - repo_versions - allowlist)
    if missing:
        failed = True
        prod_by_version = {row["version"]: row.get("name") for row in prod}
        print("FAIL: these versions are applied in production but have no matching "
              "file in supabase/migrations/:")
        for v in missing:
            print(f"  {v}  ({prod_by_version.get(v) or 'no name recorded'})")
        print()
        print("If a version genuinely has no content to restore (e.g. a "
              "`supabase migration repair` placeholder with no name/statements "
              "in schema_migrations), add it to supabase/.migration_drift_allowlist "
              "with a comment explaining why -- don't allowlist a version just "
              "because it's inconvenient to reconstruct.")
        print()

    if not failed:
        print(f"OK: {len(repo_versions)} repo migration files, "
              f"{len(prod_versions)} applied in production, "
              f"{len(allowlist)} allowlisted, zero collisions, zero real gaps.")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
