#!/usr/bin/env python3
"""
Checks production for `public` schema tables that have a `school_id` column
(the project's tenant-boundary column) but aren't actually protected by it --
either RLS is off entirely, or every policy on the table has RLS on but
doesn't reference either of the two functions every other tenant-scoped
policy in this codebase goes through (auth_school_id() / auth_is_super_admin()).

Why this exists: the 2026-09-14 production-readiness audit verified the
tenant-isolation pattern (auth_school_id() derived server-side from the
session, never trusted from the client) against a *sample* of ~8 tables out
of roughly 120 and found it consistently correct everywhere it looked --
but "consistent everywhere sampled" isn't "verified everywhere," and a table
added later that has a school_id column but forgets to wire up RLS (or wires
up a policy that checks something else and doesn't reference the shared
helper) is exactly the kind of one-line omission that's invisible in a code
review and only obvious once you ask Postgres directly what's actually
enforced. Same reasoning as anon-execute-drift-check.yml: check the one
thing that can't lie -- production's actual pg_policies / relrowsecurity
state -- on a schedule, instead of relying on every future migration author
remembering this by hand.

Not a flag on its own: RLS enabled with zero policies. That's the students
table's DELETE case (see AGENTS.md / the audit report) -- no policy at all
means Postgres denies by default, which is a *safe* posture (a genuinely
tenant-scoped table where writes only happen through a SECURITY DEFINER RPC,
say), not a gap. What this script actually flags:

  1. RLS disabled on a table that has a school_id column at all -- an open
     door, no exceptions expected.
  2. RLS enabled, at least one policy exists, but *none* of them reference
     auth_school_id() or auth_is_super_admin() -- means tenant scoping is
     either missing or implemented some other way that needs a human to
     confirm is actually correct (e.g. scoped via a join to a parent table
     instead of directly, which is legitimate but should be an explicit,
     reviewed allowlist entry with a comment, not silently invisible).

Requires PROD_SCHOOL_TABLES_JSON env var: a JSON array of
{"table": "...", "rls_enabled": bool, "policy_count": int,
 "references_tenant_helper": bool} objects, as produced by:

  psql "$SUPABASE_DB_URL" -Atqc "
    select coalesce(json_agg(row_to_json(x)), '[]') from (
      select
        t.table_name as table,
        c.relrowsecurity as rls_enabled,
        coalesce(p.policy_count, 0) as policy_count,
        coalesce(p.has_tenant_ref, false) as references_tenant_helper
      from information_schema.tables t
      join pg_class c on c.relname = t.table_name
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.table_schema
      left join (
        select tablename,
               count(*) as policy_count,
               bool_or(
                 coalesce(qual, '') ilike '%auth_school_id%'
                 or coalesce(with_check, '') ilike '%auth_school_id%'
                 or coalesce(qual, '') ilike '%auth_is_super_admin%'
                 or coalesce(with_check, '') ilike '%auth_is_super_admin%'
               ) as has_tenant_ref
        from pg_policies
        where schemaname = 'public'
        group by tablename
      ) p on p.tablename = t.table_name
      where t.table_schema = 'public'
        and t.table_type = 'BASE TABLE'
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public'
            and col.table_name = t.table_name
            and col.column_name = 'school_id'
        )
    ) x;
  "
"""
import json
import os
import sys

ALLOWLIST_PATH = "supabase/.rls_coverage_allowlist"


def load_allowlist():
    if not os.path.exists(ALLOWLIST_PATH):
        return set()
    names = set()
    with open(ALLOWLIST_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            names.add(line)
    return names


def main():
    raw = os.environ.get("PROD_SCHOOL_TABLES_JSON")
    if raw is None:
        print(
            "PROD_SCHOOL_TABLES_JSON is not set -- failing loudly instead of "
            "silently reporting no drift.",
            file=sys.stderr,
        )
        return 1

    try:
        tables = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Could not parse PROD_SCHOOL_TABLES_JSON as JSON: {e}", file=sys.stderr)
        return 1

    allowlist = load_allowlist()
    findings = []

    for t in tables:
        name = t["table"]
        if name in allowlist:
            continue

        if not t["rls_enabled"]:
            findings.append(f"  - {name}: RLS is DISABLED but this table has a school_id column")
            continue

        if t["policy_count"] > 0 and not t["references_tenant_helper"]:
            findings.append(
                f"  - {name}: RLS is on with {t['policy_count']} polic(ies), "
                "but none reference auth_school_id()/auth_is_super_admin() -- "
                "confirm tenant scoping is actually enforced some other legitimate "
                "way (e.g. via a join to an already-scoped parent table), then add "
                f"it to {ALLOWLIST_PATH} with a comment explaining how."
            )

    if findings:
        print("RLS tenant-coverage drift detected:\n")
        print("\n".join(findings))
        print(
            f"\nIf any of these are legitimate (not actually a gap), add the table "
            f"name to {ALLOWLIST_PATH} on its own line with a `#` comment explaining "
            "why -- same pattern as supabase/.anon_execute_definer_allowlist."
        )
        return 1

    print(f"No RLS tenant-coverage drift -- checked {len(tables)} school_id-bearing table(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
