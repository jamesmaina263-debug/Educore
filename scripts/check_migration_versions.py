#!/usr/bin/env python3
"""Database-free check of supabase/migrations/ filenames. Safe to require on every PR.

Why this exists (2026-10-20): `Deploy migrations` failed on main three times with
`duplicate key value violates unique constraint "schema_migrations_pkey"` because two
migration files in the repo shared one version prefix (e.g. 20261019140000_admin_trial_funnel
and 20261019140000_school_signup_review). Supabase records ONE row per version, so the second
file can never be applied. The existing drift check already detected this, but it needs the
production DB secret, is advisory, and also fails for unrelated reasons (real production drift),
so it was never a safe thing to require. This check needs nothing but the checked-out repo, so
it is deterministic and works on Dependabot/fork PRs too.

Fails (exit 1) when, inside supabase/migrations/:
  1. a .sql file isn't named <14-digit version>_<snake_case_description>.sql
  2. two files share the same version

Deliberately NOT checked: that the version is a real calendar timestamp. Ten already-applied
legacy migrations (20260918114860..69) use seconds 60-69 as a sequence counter, so that check
would fail main on day one for no benefit.

Fix a collision by giving the newer file a free version -- never by hand-picking a round
number. `python3 scripts/new_migration.py <name>` generates a collision-free one.

Usage: check_migration_versions.py [migrations_dir]   (default: supabase/migrations)
"""
import os
import re
import sys
from collections import defaultdict

DEFAULT_DIR = "supabase/migrations"
NAME_RE = re.compile(r"^(\d{14})_([a-z0-9_]+)\.sql$")


def check(migrations_dir):
    """Return a list of (file_or_None, message) problems; empty list means clean."""
    problems = []
    by_version = defaultdict(list)
    for fname in sorted(os.listdir(migrations_dir)):
        if not fname.endswith(".sql"):
            continue
        m = NAME_RE.match(fname)
        if not m:
            problems.append((
                fname,
                f"{fname} must be named <14-digit version>_<snake_case_description>.sql "
                "(lowercase letters, digits and underscores only).",
            ))
            continue
        by_version[m.group(1)].append(fname)

    for version, names in sorted(by_version.items()):
        if len(names) > 1:
            listing = ", ".join(names)
            problems.append((
                names[-1],
                f"Version {version} is shared by {len(names)} files: {listing}. "
                "Supabase records one row per version, so only one can ever be applied and "
                "'Deploy migrations' will fail with a duplicate-key error. Rename the newer "
                "file to a free version (python3 scripts/new_migration.py <name> prints one).",
            ))
    return problems


def main(argv):
    migrations_dir = argv[1] if len(argv) > 1 else DEFAULT_DIR
    if not os.path.isdir(migrations_dir):
        print(f"::error::{migrations_dir} not found -- run from the repository root.")
        return 2
    problems = check(migrations_dir)
    if not problems:
        count = sum(1 for f in os.listdir(migrations_dir) if f.endswith(".sql"))
        print(f"OK: {count} migration files, all well-formed with unique versions.")
        return 0
    print(f"FAIL: {len(problems)} problem(s) in {migrations_dir}/\n")
    for fname, message in problems:
        print(f"  - {message}")
        # GitHub turns this into an inline annotation on the PR's Files tab.
        path = f"{migrations_dir}/{fname}" if fname else migrations_dir
        print(f"::error file={path}::{message}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
