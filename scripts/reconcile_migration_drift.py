#!/usr/bin/env python3
"""
Auto-remediation half of the migration-drift system in check_migration_drift.py.

That script only detects drift (prod has a version git doesn't) and fails CI.
Today (2026-09-02) that happened three times in about an hour -- each one
silently blocked deploy-functions.yml (via its schema-sync guard) until a
human or agent noticed the failed check, manually queried
supabase_migrations.schema_migrations, and hand-wrote a matching migration
file. This script does that reconciliation automatically instead.

It deliberately reuses check_migration_drift.py's own load_repo_versions()
and load_allowlist() rather than reimplementing the comparison -- so the two
scripts can never disagree about what counts as "missing".

For each missing version that has BOTH a name and non-empty recorded
statements, it writes supabase/migrations/{version}_{name}.sql with the
exact statements already applied to prod (array_to_string(statements, E'\\n'),
the same join used for the byte-for-byte verification done by hand during
today's incident) plus a header comment marking it auto-generated.

For a missing version with no name/statements recorded (a `migration repair`
placeholder -- see supabase/.migration_drift_allowlist's own comment for why
these exist), there's nothing to reconstruct. This script does NOT guess or
skip it silently -- guessing content for a schema change is exactly the
"introspection can misattribute a later change to an earlier version" risk
the allowlist file already warns about, and silent skipping would leave CI
red with no trail. It's printed as needing a human decision (add to the
allowlist, or investigate) and the script exits non-zero if any remain,
even after writing whatever it safely could.

Requires PROD_MIGRATIONS_JSON: a JSON array of {"version", "name", "statements"}
objects (statements = array of SQL strings, as stored in
supabase_migrations.schema_migrations.statements).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_migration_drift import MIGRATIONS_DIR, load_allowlist, load_repo_versions

NAME_SANITIZE_RE = re.compile(r"[^a-z0-9_]+")


def sanitize_name(name: str) -> str:
    slug = NAME_SANITIZE_RE.sub("_", name.strip().lower()).strip("_")
    return slug or "unnamed"


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

    repo_versions = set(load_repo_versions().keys())
    allowlist = load_allowlist()

    missing = [row for row in prod if row["version"] not in repo_versions and row["version"] not in allowlist]
    if not missing:
        print("No drift to reconcile -- production and supabase/migrations/ already match.")
        return 0

    written = []
    unreconcilable = []

    for row in sorted(missing, key=lambda r: r["version"]):
        version = row["version"]
        name = row.get("name")
        statements = row.get("statements") or []
        sql_body = "\n".join(s for s in statements if s)

        if not name or not sql_body.strip():
            unreconcilable.append(version)
            print(f"SKIP {version}: no name and/or no recorded statements in "
                  f"schema_migrations -- nothing to reconstruct. This needs a human "
                  f"decision (verify individually, then add to "
                  f"supabase/.migration_drift_allowlist with a comment, or investigate "
                  f"further) -- see that file's own header for the reasoning.")
            continue

        filename = f"{version}_{sanitize_name(name)}.sql"
        path = os.path.join(MIGRATIONS_DIR, filename)
        if os.path.exists(path):
            # Shouldn't happen (version wasn't in repo_versions above), but never
            # silently clobber an existing file if it does.
            unreconcilable.append(version)
            print(f"SKIP {version}: {path} already exists locally -- refusing to "
                  f"overwrite. Investigate manually.")
            continue

        header = (
            f"-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was "
            f"applied directly to production without a matching git commit at the time. "
            f"Content below is byte-for-byte what's recorded in "
            f"supabase_migrations.schema_migrations for version {version} -- reconstructed, "
            f"not rewritten.\n\n"
        )
        with open(path, "w") as f:
            f.write(header + sql_body + "\n")
        written.append(filename)
        print(f"WROTE {path}")

    print()
    if written:
        print(f"Reconciled {len(written)} migration(s): {', '.join(written)}")
    if unreconcilable:
        print(f"{len(unreconcilable)} version(s) still need a human decision: "
              f"{', '.join(unreconcilable)}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
