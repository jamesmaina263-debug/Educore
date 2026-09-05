# EduCore — Restore Drill Runbook

**Status:** Written this session; **not yet executed**. `RPO_RTO_POLICY.md`
section 3 says it plainly: *"A DR plan that has never been tested by actually
restoring from a backup is not a verified DR plan."* This document is the
missing test — a step-by-step procedure someone with Supabase/GitHub access
can run in ~30–45 minutes to actually prove the nightly `pg_dump` backup
(`.github/workflows/nightly-backup.yml`) is restorable, not just present.

I (Claude) cannot execute this myself: it requires a `SUPABASE_DB_URL` /
Supabase dashboard access I'm not given standing credentials for, and
deliberately shouldn't be — see `SECRETS_ROTATION_POLICY.md`. What I *can* do
is make sure the drill is a checklist anyone on the team can follow without
re-deriving the steps under incident pressure.

## Why this matters specifically for EduCore

The nightly backup workflow's "Verify dump integrity" step only proves the
dump **parses** (`pg_restore --list` succeeds) and contains table-of-contents
entries for `students`, `invoices`, `payments`, `school_users`,
`academic_years`. It does **not** prove:
- The dump actually restores into a real Postgres instance without error
  (permission/extension/ordering issues only show up on a real `pg_restore`,
  not `--list`).
- RLS policies, functions, and triggers come back correctly (`--no-owner
  --no-privileges` is used deliberately for portability, but that means
  ownership-dependent objects need to be checked post-restore, not assumed).
- Row counts and spot-checked records match production, i.e. the dump isn't
  silently missing rows the table-existence check can't detect.

## Prerequisites

- A throwaway Postgres instance to restore into — **never restore into
  production**. Two options, either is fine for the drill:
  - A new, temporary Supabase project (Free plan is fine for this), or
  - A local Postgres 17 instance (`docker run -e POSTGRES_PASSWORD=drill -p
    5433:5432 postgres:17`)
- `postgresql-client-17` locally (same version-pinning reasoning as the
  backup workflow — `pg_restore` from a mismatched major version can fail or
  silently misbehave)
- The most recent `educore-backup-*.dump` artifact, downloaded from the
  `Nightly database backup` workflow's most recent successful run
  (GitHub → Actions → Nightly database backup → latest run → Artifacts)
- Read access to the production `students`, `invoices`, `payments` row
  counts for comparison (Supabase dashboard → Table Editor, or
  `Supabase:execute_sql` if using the MCP connection)

## Procedure

### 1. Get the dump file

Download the artifact zip from the workflow run, unzip it, confirm you have
`educore-backup-YYYY-MM-DD.dump`.

### 2. Stand up the throwaway target

Local Postgres option:
```bash
docker run --name educore-restore-drill -e POSTGRES_PASSWORD=drill -p 5433:5432 -d postgres:17
```

Supabase-project option: create a new project in the dashboard, grab its
connection string (Project Settings → Database → Connection string, URI
format).

### 3. Restore

```bash
pg_restore --no-owner --no-privileges --clean --if-exists \
  -d "postgresql://postgres:drill@localhost:5433/postgres" \
  educore-backup-YYYY-MM-DD.dump
```

Expect some warnings (e.g. about roles or extensions that don't exist on a
bare Postgres instance — `pgsodium`, `supabase_vault`, etc. if used) — those
are expected on a non-Supabase target and not a drill failure by themselves.
**A drill failure is**: the command exits non-zero on anything other than
those known-safe warnings, or a core table listed below fails to restore.

### 4. Verify — this is the part the CI check can't do

Run each of these against the restored database and compare to production
(pull the production numbers from the Supabase dashboard's Table Editor row
counts, or via SQL if you have direct access):

```sql
select 'students' as t, count(*) from students
union all select 'invoices', count(*) from invoices
union all select 'payments', count(*) from payments
union all select 'attendance_records', count(*) from attendance_records
union all select 'marks', count(*) from marks
union all select 'school_users', count(*) from school_users;
```

Row counts should match production as of the backup's timestamp (02:00 UTC)
within the normal day's activity — not exact if the drill runs hours later
and production kept changing, but in the right ballpark, not zero and not
missing a table entirely.

Then spot-check a handful of actual records rather than trusting counts
alone — e.g. pick 3 real student IDs from production and confirm the same
students, with the same names and `school_id`, exist in the restored copy.

### 5. Record the result

Append a dated entry to the log at the bottom of this file: pass/fail, row
counts observed, anything unexpected. This is what turns "we have a backup"
into "we have a *verified* backup" — a single successful drill plus a
recurring cadence (recommend quarterly, or immediately after any schema
change that touches extensions/roles) is the actual DR guarantee, not the
nightly workflow succeeding in isolation.

### 6. Tear down

Drop the throwaway Supabase project or `docker rm -f educore-restore-drill`.
Never leave a full copy of production student/finance data sitting in an
extra, less-monitored project.

## What this does not cover (call these out separately if they matter to you)

- **RTO measurement.** This drill proves restorability, not how long a real
  incident recovery would take end-to-end (DNS/Vercel env repointing,
  `NEXT_PUBLIC_SUPABASE_URL` swap, informing schools, etc.) — worth timing
  once this drill has been run successfully at least once.
- **PITR.** This is a point-in-time-of-last-nightly-dump restore only (RPO up
  to ~24h, per `RPO_RTO_POLICY.md`). True point-in-time recovery is a
  Supabase Pro-plan-and-up feature and a billing decision, not something this
  runbook changes.

## Drill log

| Date | Run by | Result | Notes |
|------|--------|--------|-------|
| _(none yet)_ | | | First execution still pending — see status note at top of file. |
