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


## Database migrations

The **Deploy migrations** workflow runs `supabase db push --include-all` on every push to
`main`. Two things break it, and both have happened repeatedly:

- **A migration applied straight to production (e.g. via the Supabase MCP) and committed under a
  different timestamp.** Production records the version it was applied under. If the repo file has
  another version, `db push` stops entirely with "Remote migration versions not found in local
  migrations directory", and nothing after it deploys. If you must apply directly, commit the file
  under the *exact* version production recorded
  (`select version, name from supabase_migrations.schema_migrations order by version desc limit 5`),
  or insert a `schema_migrations` row whose version matches your repo filename. Better: don't apply
  directly — put the file in the PR and let the workflow apply it on merge.
- **A migration file that is not safe to run twice, for something already live.** `db push` runs any
  file whose version isn't recorded. Reconciliation files that `drop policy` / `create policy`
  without `if exists` fail if the change was already applied by hand. Either record the version as
  applied (after verifying the effect is really live) or make the statements idempotent.

Never commit a second file that duplicates an already-recorded migration under a new timestamp.

If code depends on a new function/column/constraint, apply the migration *before* merging the code
(Vercel deploys on merge and the migration workflow runs in parallel — the code can go live first).

Every `SECURITY DEFINER` function must `revoke execute ... from public, anon, authenticated`
unless it is meant to be called by clients (and then it must check permissions itself). New
public-schema functions get PUBLIC EXECUTE by default.
