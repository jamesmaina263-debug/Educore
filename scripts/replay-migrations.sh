#!/usr/bin/env bash
# Applies every supabase/migrations/*.sql to $DB_URL in version order, each file in its own
# transaction (as the Supabase CLI does), without stopping at the first failure.
#
#   DB_URL          required, libpq connection string of a THROWAWAY database
#   KNOWN_FAILURES  file listing migrations expected to fail on a fresh database
#                   (default .github/db-replay-known-failures.txt)
#   MIGRATIONS_DIR  default supabase/migrations
#
# Exit non-zero if any migration NOT in the known-failures list fails. A known-failure file that now
# applies cleanly is reported as a warning so the list can be pruned.
set +e
dir="${MIGRATIONS_DIR:-supabase/migrations}"
known="${KNOWN_FAILURES:-.github/db-replay-known-failures.txt}"
ok=0; skipped=0; unexpected=0; stale=0
unexpected_msgs=""; stale_msgs=""

for f in "$dir"/*.sql; do
  name=$(basename "$f")
  is_known=0
  [ -f "$known" ] && grep -qxF "$name" "$known" && is_known=1
  out=$(psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$f" 2>&1)
  code=$?
  if [ $code -eq 0 ]; then
    ok=$((ok + 1))
    if [ $is_known -eq 1 ]; then
      stale=$((stale + 1)); stale_msgs="${stale_msgs}${name}%0A"
    fi
    continue
  fi
  if [ $is_known -eq 1 ]; then
    skipped=$((skipped + 1))
    continue
  fi
  unexpected=$((unexpected + 1))
  err=$(echo "$out" | grep -m1 -E "ERROR" | cut -c1-260 | tr -d '\r' | sed 's/%/%25/g')
  echo "::group::FAILED $name"; echo "$out" | head -40; echo "::endgroup::"
  unexpected_msgs="${unexpected_msgs}${name}: ${err}%0A"
done

echo "replay: applied=$ok known_failures_skipped=$skipped unexpected_failures=$unexpected stale_known=$stale"
{
  echo "### Migration replay on a fresh database"
  echo "applied: $ok, known non-replayable (skipped): $skipped, **unexpected failures: $unexpected**"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

[ -n "$stale_msgs" ] && echo "::warning title=${stale} migration(s) in db-replay-known-failures.txt now replay cleanly, remove them::${stale_msgs}"
if [ -n "$unexpected_msgs" ]; then
  echo "::error title=${unexpected} migration(s) failed to apply on a fresh database::${unexpected_msgs}"
  exit 1
fi
exit 0
