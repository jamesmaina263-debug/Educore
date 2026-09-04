# EduCore — Backup / Disaster Recovery: RPO, RTO, and Current Reality

**Status:** Real gap found and partially closed this session (Gap Analysis
Tier 2 #17). Read section 1 before assuming backups exist — they mostly
don't yet.

## 1. The honest current state

EduCore's Supabase project (`Educore`, `alzqlvfaftwegptfbfej`) is on the
**Free plan**. Checked directly against Supabase's own documentation this
session (not assumed from memory): the Free plan receives **zero automated
backups** — daily backups and Point-in-Time Recovery are both Pro-plan-and-up
features. Supabase's own guidance for Free-tier projects is to manually
export data on your own schedule and keep an off-site copy.

This means, as of this session, if the production database were lost or
corrupted:
- **Schema** is fully recoverable — every migration is committed to
  `supabase/migrations/` in the repo (a standing rule since the Phase 3
  migration-recovery session), so `supabase db push` against a fresh
  project reproduces the exact schema.
- **Data** — every student record, mark, invoice, payment, message log —
  had **no recovery path at all** before this session's interim workflow
  (section 3) existed.

## 2. Target RPO / RTO (once a real solution is in place)

These are targets to design toward, not current guarantees:

- **RPO (Recovery Point Objective): 24 hours.** Losing up to a day of data
  is a real cost (fee payments, attendance, marks re-entered) but survivable
  for a platform with zero paying schools live yet. Tighten to hours once
  real schools have real financial data on the platform — at that point PITR
  (2-minute RPO) becomes worth its cost.
- **RTO (Recovery Time Objective): 4 hours.** Time to have the platform
  usable again after a disaster, from decision-to-restore to schools being
  able to log in again.

## 3. Interim measure built this session

Since upgrading to Supabase Pro is a cost decision for the business, not a
technical one I can make unilaterally, this session adds a **nightly logical
backup via GitHub Actions** (`.github/workflows/nightly-backup.yml`) as a
stopgap: `pg_dump` against the production database, uploaded as a workflow
artifact (90-day retention on GitHub's default).

**This needs one thing from you before it actually runs**: a `SUPABASE_DB_URL`
repository secret (GitHub → Settings → Secrets and variables → Actions) —
the full Postgres connection string, found in Supabase dashboard → Project
Settings → Database → Connection string (use the "URI" format, pooler
connection recommended). I did not attempt to retrieve or generate this
myself — it's a credential I don't have programmatic access to and
shouldn't try to extract.

**Limitations of this interim measure, stated plainly:**
- GitHub Actions artifacts are not designed as a durable backup store —
  90-day retention, tied to the repo, not truly off-site in the disaster-
  recovery sense (a compromised/deleted GitHub repo takes the backups with
  it). Good enough as a stopgap, not a real DR solution.
- It's a logical dump (`pg_dump`), so restoring means replaying it into a
  fresh Postgres instance — untested end-to-end in this session (would
  require actually standing up a second database to restore into, which
  risks nothing existing but costs real time/money I didn't spend without
  checking with you first).
- No restore drill has been performed. **A DR plan that has never been
  tested by actually restoring from a backup is not a verified DR plan** —
  this is true here. A step-by-step procedure for running one now lives at
  `docs/RESTORE_DRILL_RUNBOOK.md` (restore the latest dump into a throwaway
  Supabase project or local Postgres, verify row counts and a few
  spot-checked records match) — written this session but not yet executed,
  since it needs someone with `SUPABASE_DB_URL`/dashboard access to actually
  run it.

## 4. Recommended real fix

Upgrade the Supabase project to the Pro plan ($25/mo base) before onboarding
any real paying school — this single change closes most of this gap
automatically (daily backups included, PITR available as an add-on for
tighter RPO). This is a business/cost decision, listed here for visibility,
not something to action without your sign-off.
