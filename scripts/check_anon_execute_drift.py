#!/usr/bin/env python3
"""
Checks production's live grants for public-schema SECURITY DEFINER functions,
so a future function that ends up anon-executable (H6's pattern: PR #291/#292)
gets caught within 15 minutes instead of sitting live for weeks.

Scoped to SECURITY DEFINER only, not every anon-executable function in public.
A SECURITY INVOKER function running with the caller's own permissions is still
subject to RLS -- anon being able to call one is far lower risk than anon being
able to call a SECURITY DEFINER function, which runs with the *definer's*
privileges and bypasses RLS entirely. This project has ~15 SECURITY INVOKER
trigger/helper functions that are anon-executable today (not ideal, but not the
H6 risk pattern); allowlisting all of those would dilute this check and bury
the signal. If one of those is later found to matter, add it to the allowlist
explicitly with a comment explaining why, the same way this file's entries work.

Why this exists instead of relying on the ALTER DEFAULT PRIVILEGES fix
attempted in PR #292: that migration applied cleanly and the stored
pg_default_acl entry verified correct, but a live smoke test afterward showed
new functions in public still come out anon-executable regardless -- the
actual mechanism was never identified (see that PR's migration file for the
full investigation trail). Since a source-level fix couldn't be verified to
work, this checks the one thing that can't lie: production's actual live
grants.

Requires PROD_ANON_DEFINER_JSON env var: a JSON array of
{"signature": "name(args)"} objects for every SECURITY DEFINER function in
`public` where has_function_privilege('anon', ..., 'EXECUTE') is true, as
produced by:
  psql "$SUPABASE_DB_URL" -Atqc \
    "select coalesce(json_agg(json_build_object('signature',
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')), '[]')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and has_function_privilege('anon', p.oid, 'EXECUTE');"
"""
import json
import os
import sys

ALLOWLIST_PATH = "supabase/.anon_execute_definer_allowlist"


def load_allowlist():
    if not os.path.exists(ALLOWLIST_PATH):
        return set()
    signatures = set()
    with open(ALLOWLIST_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            signatures.add(line)
    return signatures


def main():
    raw = os.environ.get("PROD_ANON_DEFINER_JSON")
    if raw is None:
        print("PROD_ANON_DEFINER_JSON is not set -- failing loudly instead of "
              "silently passing.")
        return 1

    try:
        live = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Could not parse PROD_ANON_DEFINER_JSON as JSON: {e}")
        return 1

    live_signatures = {row["signature"] for row in live}
    allowlisted = load_allowlist()
    unexpected = sorted(live_signatures - allowlisted)

    if not unexpected:
        print(f"OK -- {len(live_signatures)} SECURITY DEFINER function(s) anon-executable "
              f"in public, all allowlisted.")
        return 0

    print("FAIL -- SECURITY DEFINER function(s) in public are anon-executable and "
          "not in the allowlist:")
    for sig in unexpected:
        print(f"  {sig}")
    print()
    print("If this is intentional (a function meant to be called by unauthenticated "
          f"users), add it to {ALLOWLIST_PATH} with a comment explaining why. "
          "Otherwise, revoke it the same way H6 (PR #291) did:")
    print("  revoke execute on function public.<name>(<args>) from anon;")
    return 1


if __name__ == "__main__":
    sys.exit(main())
