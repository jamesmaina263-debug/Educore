# Growth Engine: AI gateway and verified product facts

Part of the Growth Engine work (PR 1 of 5). No database changes.

## What changed

1. `src/lib/growth/product-facts.ts` is the one place that lists what outbound/sales AI may claim about EduCore.
   Every claim names the repository file that proves it. `product-facts.test.ts` fails if an evidence file
   disappears, if the published price drifts from the pricing page, or if the trial wording stops matching
   `src/lib/marketing/trial.ts`.
2. `src/lib/ai/platform-ai.ts` is a thin gateway over the existing Gemini helpers (no new provider client).
   It adds a kill switch, an output-token cap, a timeout and token-usage capture.
3. `/admin/outreach` "Score & draft" now uses both. Token usage is written to the existing admin activity log
   (`platform_admin_activity_log`, action `score_outbound_prospects`).

School-facing AI (report-card comments, schemes of work, the parent WhatsApp bot) is untouched.

## Environment variables (all optional)

| Variable | Effect |
|---|---|
| `PLATFORM_AI_DISABLED=true` | Turns every platform AI call off. Takes effect on the next deploy/restart of the env. |
| `PLATFORM_AI_DISABLED_TASKS=outreach_scoring` | Turns off named tasks only. |
| `PLATFORM_AI_MAX_OUTPUT_TOKENS=1024` | Lowers the ceiling on any call's output tokens (default 2048). It can only lower it. |
| `OUTREACH_SCORE_BUDGET_MS=8000` | How long one "Score & draft" click may keep starting AI calls (2000–50000, default 8000). Prospects not reached stay selectable; the UI says how many are left. |

`GEMINI_API_KEY` is the existing variable. Without it, scoring stops with a clear message and nothing else is affected.

### About the 8-second default

The hosting plan's real serverless time limit was not verifiable from the API (the account is on the free plan).
8 seconds is deliberately conservative so a click cannot be cut off mid-run. Once the actual limit is confirmed
in the Vercel dashboard, raise `OUTREACH_SCORE_BUDGET_MS` to match. Each prospect is saved as soon as it is
scored, so an interrupted click never loses finished work.

## Adding or changing a product claim

1. Verify the capability in the repository (code, migration or UI), not from memory or marketing copy.
2. Add it to `VERIFIED_FACTS` with its `evidence` path. Keep the wording conservative.
3. Run `npx vitest run src/lib/growth`.

Claims that must never be added without separate written verification: approval, certification or endorsement
by KICD, the Ministry of Education, KNEC, Safaricom or any regulator; discounts or custom prices; customer
names, testimonials or statistics; integrations or features that are not live.

Wording note: report output is described as **competency-based learner progress reports**. The code shows CBC
competency ratings by sub-strand on report cards (`src/components/exams/report-card-list.tsx`), but nothing is
specific to pre-primary, so kindergarten wording must not say the reports are "designed for" pre-primary.

## Rollback

Revert the PR. There is no migration and no data change.

## Not covered by this PR (tracked for later)

- A database-backed AI switch editable from the admin UI (needs a migration).
- STOP/opt-out handling and a contact log for outreach (PR 2 and 3).
- `discoverSchoolsByCounty` still tries two public map servers in sequence with a 55-second timeout each. On a
  small serverless limit that can be cut off. It only stages rows, so nothing is corrupted, but it should get
  its own time budget.
- The model name `gemini-3.5-flash-lite` is carried over unchanged and was not independently verified.
