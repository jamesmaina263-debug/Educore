<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Git workflow

`main` is protected: no direct pushes (enforced for admins too), and the `ci`
GitHub Actions check (type-check, lint, tests, build) must pass before a PR
can merge. Auto-merge is enabled at the repo level, so the flow is:

1. Branch off `main`.
2. Push the branch, open a PR.
3. Enable auto-merge on the PR (squash) — it merges itself once `ci` goes
   green, no need to babysit it.

Merged branches are auto-deleted.


## Live tenants — production data caution

Some schools in this database are real, live schools with real staff and
students, not test/demo data. Treat them with production-level caution:
no speculative writes, no new synthetic/test/QA accounts created against
them without being explicit that's what's happening, and any schema or
data change gets double-checked before it's applied.

Known tenant status (confirm current status before assuming it's stale):
- Little Beginners School (`bc0e14ef-25ed-492d-8999-8d9718c3c2d1`) — LIVE,
  real staff.
- Gititu High Schoool — trial tenant (as of 2026-08-22).
- Demo Academy — demo tenant.

QA/test logins: the old `public.ensure_qa_test_account()` helper has been removed
(security review N3, 2026-10-03) -- it minted privileged accounts with a password that
was committed to this public repo. Do not recreate it, and never put a plaintext
password (test, demo or otherwise) in a migration, script, doc or commit message.
If a session genuinely needs a throwaway login, create it through the Supabase Auth
admin API with a random password that is never written to the repo, tell the owner
that's what is happening, and delete the account when done.

## Database migrations

**Never apply a migration to production by hand** (Supabase MCP `apply_migration`, the dashboard,
`psql`, `execute_sql` with DDL). Put the file in `supabase/migrations/` in a PR and let the
**Deploy migrations** workflow apply it on merge. `.claude/settings.json` denies
`apply_migration` for Claude Code sessions; don't work around it.

The workflow runs `supabase db push --include-all` on every push to `main`. A hand-applied
migration breaks it for the whole repo: production records a version with no matching file, `db push`
stops with "Remote migration versions not found in local migrations directory", and **nothing after
it deploys** (2026-10-19: two hand-applied migrations blocked every deploy for hours).

**If code depends on a new function/column/constraint:** merge the migration in its own PR first,
wait for Deploy migrations to go green, *then* merge the code PR. (Vercel deploys on merge and the
migration workflow runs in parallel, so putting both in one PR lets the code go live first.) Do not
apply the migration by hand to "get ahead" of the code.

**Break-glass only (live outage, no other way):** tell the owner first, apply it, then in the same
session commit the file under the *exact* version production recorded
(`select version, name from supabase_migrations.schema_migrations order by version desc limit 5`)
and open the PR immediately. Never commit it under a different timestamp, and never leave it
uncommitted: the drift check will open an auto-reconcile PR if you do, but that is the backstop,
not the plan.

Other rules:
- **Migrations must be safe to run twice for anything already live.** `db push` runs any file
  whose version isn't recorded. Reconciliation files that `drop policy` / `create policy` without
  `if exists` fail if the change was already applied by hand. Make statements idempotent, or record
  the version as applied after verifying the effect is really live.
- Never commit a second file that duplicates an already-recorded migration under a new timestamp.

Every `SECURITY DEFINER` function must `revoke execute ... from public, anon, authenticated`
unless it is meant to be called by clients (and then it must check permissions itself). New
public-schema functions get PUBLIC EXECUTE by default.
