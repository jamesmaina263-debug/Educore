# Database tests in CI

SQL behavior tests live in `supabase/tests/*.sql`. Each is rollback-only (`begin; ... rollback;`) and
asserts behavior with `assert` inside a `do $$` block. Two workflows run the same suite
(`scripts/run-db-tests.sh`) at two points:

| | When | Against | Catches |
|---|---|---|---|
| `db-tests-pr.yml` | pull requests touching migrations or tests | a throwaway Supabase Postgres built in the job, no secrets | a migration that does not apply, a test that does not pass, **before merge** |
| `db-behavior-checks.yml` | after Deploy migrations on `main`, nightly 03:00 UTC, manual | production | drift in production data (a flag turned on for a real school, live rows) that a fresh database cannot show |

## Adding a test
Drop a rollback-only file in `supabase/tests/`. No workflow to write. The runner refuses a file with no
`rollback;` so a test can never commit to a database. Scope assertions to your own fixture rows
(for example the fixture school), never to a whole table or flag: production has real data.

## The two lists
- `.github/db-checks-advisory.txt` (production) and `.github/db-checks-advisory-pr.txt` (PR): tests
  listed here warn instead of failing. They exist because the fixture is stale, not because the
  failure is acceptable. Fix the fixture, then delete the line.
- `.github/db-replay-known-failures.txt`: 35 historical migrations that cannot be replayed on a fresh
  database. The repo history has holes (policies dropped that no migration created, a column that
  exists only in production, one-off Gititu data fixes). They are already applied in production, so
  deploys are unaffected. The PR check skips exactly these and fails on any other replay error, so a
  new migration that fails to apply turns the PR red. Prefer writing new migrations idempotently
  (`if not exists`, `drop ... if exists`) so they replay anywhere.

## Reading a failed run
Failures appear as one aggregated annotation per level on the run page and as a per-test table in the
run summary. Raw job logs are not needed.
