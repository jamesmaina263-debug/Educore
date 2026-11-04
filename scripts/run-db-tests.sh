#!/usr/bin/env bash
# Runs every rollback-only SQL behavior test in supabase/tests/ against $DB_URL, one at a time.
# Shared by db-behavior-checks.yml (production, after deploy) and db-tests-pr.yml (throwaway DB).
#
#   DB_URL         required, libpq connection string
#   ADVISORY_FILE  tests listed here (one filename per line) warn instead of failing
#                  (default .github/db-checks-advisory.txt)
#   ALL_ADVISORY=1 treat every test as advisory (used to map a new environment)
#   TESTS_GLOB     default supabase/tests/*.sql
#   SUITE_LABEL    heading for the run summary
#
# A file with no `rollback;` is refused, so a test can never commit to the target database.
# Exit code is non-zero only if a blocking test fails.
set +e
advisory="${ADVISORY_FILE:-.github/db-checks-advisory.txt}"
blocking_failed=0
advisory_failed=0
passed=0
blocking_msgs=""
advisory_msgs=""
{ echo "| Test | Mode | Result |"; echo "|---|---|---|"; } > /tmp/summary.md

for f in ${TESTS_GLOB:-supabase/tests/*.sql}; do
  name=$(basename "$f")
  mode=blocking
  if [ "${ALL_ADVISORY:-0}" = "1" ] || { [ -f "$advisory" ] && grep -qxF "$name" "$advisory"; }; then mode=advisory; fi

  echo "::group::$name ($mode)"
  if ! grep -qiE '^\s*rollback\s*;' "$f"; then
    out="refusing to run $name: no rollback; statement, it could write to production"
    code=1
    echo "$out"
  else
    out=$(timeout 300 psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" 2>&1)
    code=$?
    echo "$out"
  fi
  echo "::endgroup::"

  if [ "$code" -eq 0 ]; then
    passed=$((passed + 1))
    echo "| $name | $mode | pass |" >> /tmp/summary.md
    continue
  fi

  # GitHub caps annotations at 10 warnings and 10 errors per step, which would hide most
  # failures. Collect one line per failing test and emit a single aggregated annotation
  # per level at the end (%25 and %0A are the workflow-command escapes for % and newline).
  err=$(echo "$out" | grep -m1 -E "ERROR|refusing" | cut -c1-220 | tr -d '\r' | sed 's/%/%25/g')
  ctx=$(echo "$out" | grep -m1 -E "CONTEXT|LEAK" | cut -c1-140 | tr -d '\r' | sed 's/%/%25/g')
  entry="${name}: ${err} ${ctx}"
  if [ "$mode" = advisory ]; then
    advisory_msgs="${advisory_msgs}${entry}%0A"
  else
    blocking_msgs="${blocking_msgs}${entry}%0A"
  fi
  first=$(echo "$out" | grep -m1 -E "ERROR|refusing" | cut -c1-150 | tr '|' '/')
  if [ "$mode" = advisory ]; then
    advisory_failed=$((advisory_failed + 1))
    echo "| $name | advisory | FAIL (not blocking): $first |" >> /tmp/summary.md
  else
    blocking_failed=$((blocking_failed + 1))
    echo "| $name | blocking | **FAIL**: $first |" >> /tmp/summary.md
  fi
done

{
  echo "### ${SUITE_LABEL:-DB behavior checks}"
  echo "passed: $passed, blocking failures: $blocking_failed, advisory failures: $advisory_failed"
  echo
  cat /tmp/summary.md
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

[ -n "$blocking_msgs" ] && echo "::error title=${blocking_failed} blocking DB test(s) failing::${blocking_msgs}"
[ -n "$advisory_msgs" ] && echo "::warning title=${advisory_failed} advisory DB test(s) failing (not blocking)::${advisory_msgs}"
echo "passed=$passed blocking_failed=$blocking_failed advisory_failed=$advisory_failed"
[ "$blocking_failed" -eq 0 ]
