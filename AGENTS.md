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

If you need a QA/test staff login for a school, use the existing
`public.ensure_qa_test_account(school_id, password)` Postgres function
(service_role-only) instead of hand-rolling a one-off INSERT migration —
it's idempotent and reuses a fixed per-school account rather than
spawning lookalikes. See `COMMENT ON FUNCTION public.ensure_qa_test_account`
in the DB for the full history of why this exists (a stray QA account for
Little Beginners was created and deleted twice via ad hoc migrations
before this was added, 2026-09-17).
