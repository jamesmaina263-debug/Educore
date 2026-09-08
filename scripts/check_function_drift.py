#!/usr/bin/env python3
"""
Checks supabase/functions/*/ against production's actually-deployed edge functions
(via the Supabase Management API's list-functions endpoint), so a function deployed
straight to Supabase -- bypassing deploy-functions.yml, and therefore possibly
diverging from what's committed -- gets caught in CI instead of discovered weeks
later. This repo has hit exactly this pattern before: the 2026-09-04 Zoho/Resend
incident happened because a session edited and deployed
supabase/functions/_shared/email/index.ts directly, breaking real email sends,
and the drift was never visible anywhere. Separately, biometric-gate-webhook has
been deployed-but-never-committed since 2026-08-28 (see config.toml's comment on
it) -- exactly the same pattern, just never acted on.

Rather than diffing downloaded source (fragile -- Deno bundling/formatting can
differ from the committed source without the *logic* differing, producing noisy
false positives), this uses a much sharper signal: deploy-functions.yml always
deploys from a GitHub Actions runner, so a function it deployed always has an
`entrypoint_path` of the form
  file:///home/runner/work/<repo>/<repo>/supabase/functions/<slug>/index.ts
Any other entrypoint_path -- a local machine, the Supabase dashboard, an MCP tool,
anything -- means the function's *current live code* did not come from this
pipeline, and therefore isn't guaranteed to match what's in git. That's the drift
this check flags, without needing to fetch or diff any actual source.

Two checks:
  1. Every function slug live in Supabase must either have a matching directory
     under supabase/functions/, or be listed in supabase/.function_drift_allowlist.
  2. Every live function's entrypoint_path must match the expected CI-runner
     pattern, or be allowlisted.

A local directory with no matching live function is NOT a failure -- that's the
normal state for a function that's merged to main but not yet deployed (deploy-
functions.yml will pick it up on the next push). This check only guards the
dangerous direction: prod has it (or prod's version of it didn't come from CI),
and git doesn't reflect that.

Requires SUPABASE_FUNCTIONS_JSON env var: the raw JSON array returned by
GET https://api.supabase.com/v1/projects/{ref}/functions
"""
import json
import os
import sys

FUNCTIONS_DIR = "supabase/functions"
ALLOWLIST_PATH = "supabase/.function_drift_allowlist"
REPO_NAME = "Educore"  # matches the hardcoded project-ref style already used
                        # elsewhere in this repo's workflows (e.g. deploy-functions.yml)
EXPECTED_ENTRYPOINT = "file:///home/runner/work/{repo}/{repo}/supabase/functions/{slug}/index.ts"


def load_allowlist():
    if not os.path.exists(ALLOWLIST_PATH):
        return set()
    slugs = set()
    with open(ALLOWLIST_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            slugs.add(line)
    return slugs


def load_local_slugs():
    if not os.path.isdir(FUNCTIONS_DIR):
        return set()
    return {
        name
        for name in os.listdir(FUNCTIONS_DIR)
        if not name.startswith("_") and os.path.isdir(os.path.join(FUNCTIONS_DIR, name))
    }


def main():
    raw = os.environ.get("SUPABASE_FUNCTIONS_JSON", "").strip()
    if not raw:
        print("SUPABASE_FUNCTIONS_JSON is empty -- did the API call step fail? Failing loudly.")
        return 1

    try:
        live_functions = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Could not parse SUPABASE_FUNCTIONS_JSON as JSON: {e}")
        return 1

    local_slugs = load_local_slugs()
    allowlist = load_allowlist()

    failed = False
    missing_from_repo = []
    wrong_entrypoint = []

    for fn in live_functions:
        slug = fn.get("slug")
        entrypoint = fn.get("entrypoint_path", "")
        if slug in allowlist:
            continue
        if slug not in local_slugs:
            missing_from_repo.append(slug)
            continue
        expected = EXPECTED_ENTRYPOINT.format(repo=REPO_NAME, slug=slug)
        if entrypoint != expected:
            wrong_entrypoint.append((slug, entrypoint))

    if missing_from_repo:
        failed = True
        print("FAIL: these functions are live in Supabase but have no matching "
              "directory in supabase/functions/:")
        for slug in sorted(missing_from_repo):
            print(f"  {slug}")
        print()

    if wrong_entrypoint:
        failed = True
        print("FAIL: these functions' live code did not come from deploy-functions.yml "
              "(entrypoint_path doesn't match the expected CI-runner pattern), so the "
              "live version may not match what's committed:")
        for slug, entrypoint in sorted(wrong_entrypoint):
            print(f"  {slug}: {entrypoint}")
        print()

    if failed:
        print(
            "A function in this state needs a real fix, not a silent allowlist add: "
            "either redeploy it via deploy-functions.yml (push a no-op commit touching "
            "that function's directory, or re-run the workflow) so its entrypoint_path "
            "matches the committed source, or -- only if it's genuinely meant to stay "
            "outside git for now -- add it to supabase/.function_drift_allowlist with a "
            "comment explaining why, the same way biometric-gate-webhook was flagged in "
            "config.toml but never actually reconciled."
        )
        return 1

    print("OK: no edge-function drift detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
