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

