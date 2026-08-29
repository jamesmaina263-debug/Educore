# EduCore Marketing Site — Status & Roadmap

**Last updated:** 2026-08-29 (post-Phase-9 audit-and-remediation pass discovered and verified — see Section 3a)
**Branch:** `feature/marketing-site` — **NOT merged to `main`**. Merge only after a proper, explicitly-approved final audit is complete. Confirmed via `git merge-base` this branch is still not an ancestor of `main` as of 2026-08-29.
**⚠️ Branch history was rebased/force-pushed** at some point after Phase 9 closed out (all commit hashes on this branch changed, content preserved — verified nothing was lost). If a session's local clone predates this, `git fetch` + `git reset --hard origin/feature/marketing-site` before doing anything else, or drift-checks will misfire.
**Live preview (latest):** deploys automatically from this branch on every push, via Vercel's GitHub integration. Get the current URL from Vercel → Deployments → filter by branch `feature/marketing-site`, or ask whichever Claude session is active to fetch the latest one. This is a preview deployment (`target: null`), not production — it never affects the live site.

If you are a Claude session picking this up fresh: **read this whole document before writing any code.** It tells you what already exists, what's already been decided, and exactly what's left. Re-doing anything below wastes the user's time and risks conflicting with work already reviewed and approved.

---

## 1. What this project is

A public marketing website for EduCore (a school management SaaS), added to the *same* Next.js app/repo as the existing authenticated product (`jamesmaina263-debug/Educore`), living alongside it without modifying its functionality, auth, database, or RLS.

## 2. Decisions already made and approved — do not re-litigate these

| Decision | What was decided |
|---|---|
| Routing | `/` = marketing homepage (not a redirect to `/dashboard`). Marketing pages: `/platform`, `/solutions`, `/ai-automation`, `/pricing`, `/about`, `/contact`, `/faq` (original 7), plus `/privacy`, `/terms`, `/finance-fees`, `/security` (added in the undocumented audit pass — see Section 3a). All 11 are in `NEVER_PREFIX`. All existing app routes (`/login`, `/dashboard`, everything under the `(app)` route group) unchanged. |
| Brand colours | Navy, gold, and blue (sampled from the actual logo), **not green**. See token list in Section 4. |
| AI page route name | `/ai-automation`, not `/ai` — `/ai` already exists as a real authenticated module (`(app)/ai/`) and would be a build-breaking collision. |
| Content honesty | Every module, AI feature, and "why EduCore" claim on the site must correspond to something that actually exists in the codebase — verified by grep, not assumed. No invented statistics, testimonials, customer logos, or planned-but-unbuilt features presented as live. |
| Process | Greenlight policy: one phase built and verified at a time, explicit owner sign-off before the next phase starts. |
| Merge policy | This branch is merged to `main` only when the entire site (all phases below) is complete, tested, and the owner has said so explicitly. |

## 3. What's been built so far (Phases 1–9 of 10 — all except Phase 10)

**Note on ordering:** Phase 9 was built before Phase 8 landed, because a separate concurrent session was handling Phase 8 (About & Contact) at the time. Mid-Phase-9, that session pushed its work (About/Contact pages, a new isolated `marketing_demo_requests` table with insert-only RLS, plus a factual correction to the Solutions page's student-portal claim). This session rebased its Phase 9 commit cleanly on top with no conflicts, then updated `sitemap.ts` (added `/about`/`/contact`, which had deliberately been left out until they were real) and added OG/Twitter/canonical metadata to the About/Contact pages for consistency with the rest of Phase 9's SEO work, since Phase 8 predated that.

All of this is committed to `feature/marketing-site`, verified (typecheck + lint + full existing test suite + full production build + live preview-deployment fetches confirming actual runtime behavior, not just code review), and reviewed/approved by the project owner at each step.

## 3a. ⚠️ Undocumented work discovered after Phase 9 (2026-08-29)

Some session(s) — not this line of continuity, and never logged here — did substantial additional work on this branch after Phase 9 closed out, then force-pushed a rebase onto the latest `main` on top of it. This was **discovered**, not planned by the session that found it: the branch's own commit log was the only record: `git log --oneline d0928b5..997a336` (old hash `d0928b5` = this doc's last known-good Phase 9 checkpoint; content-identical commit now lives at a different hash post-rebase).

**What actually happened, in order** (17 commits, own "Phase 1–11" fix-batch numbering — ⚠️ **not the same phases as this doc's Section 6 roadmap**, a separate audit-severity numbering that happens to reuse 1–11):
- P0/P1 severity fixes across the whole site: legal pages, structured data (JSON-LD), OG image generation (`opengraph-image.tsx` — resolves the "no OG image" gap flagged at the end of the real Phase 9), form hardening, security headers, an analytics integration point
- SEO keyword mapping / reconciliation passes on existing pages
- **3 new marketing pages, not in the original 7-route plan:** `/privacy`, `/terms`, `/security`, plus `/finance-fees` (4 new routes total) — all correctly added to `NEVER_PREFIX`
- Mobile nav menu, a real `/_not-found` page, footer link reorganization
- Content additions to existing pages: EduCore Connect added to Platform/Solutions, Timetable Management + NEMIS added to Solutions
- Rate-limiting on the demo-request form
- **An unplanned "Phase 11"**: CTA click tracking + first-touch marketing attribution (UTM params) on demo requests, plus a Plausible analytics integration (cookie-less, no-op until an env var is manually set, doesn't collect PII)

**What this session verified about that work** (did not review every line, but checked the things that matter most):
- `git merge-base --is-ancestor` confirms the branch is **not merged into `main`** — no merge-policy violation.
- The rebase preserved content — verified by commit message + diff, not just trusting hashes.
- Current full build is clean: `tsc --noEmit`, `eslint` (same 5 pre-existing warnings, 0 new), full test suite (86/86), `next build` (all 15 marketing/legal routes prerendered static, zero collisions) — all re-run fresh against the current `HEAD` as of this update, not assumed from commit messages.
- The new attribution migration (`*_marketing_demo_requests_attribution.sql`) only adds 3 nullable columns to the existing isolated, insert-only-RLS table from Phase 8 — no new table, no RLS change, no PII beyond what the form already collects.
- All 4 new routes are present in `NEVER_PREFIX`.

**Content verification — done in this session (2026-08-29).** Read all 4 new pages in full, plus the EduCore Connect and Timetable/NEMIS additions to Platform/Solutions:
- `/terms`, `/finance-fees`, EduCore Connect, and Timetable/NEMIS: all accurate. Connect independently re-verified against `(app)/connect/actions.ts` (category enum, resolved_at — matches exactly). Timetable's double-booking claim re-verified against `lib/timetable/auto-generate.ts`. Payroll's NSSF/SHIF/Housing-Levy/PAYE claim re-verified against `(app)/payroll`.
- `/security` had one overstated claim: "third-party packages checked for known vulnerabilities as part of the build process before code ships" — CI (`.github/workflows/ci.yml`) has no `npm audit` step and there's no `dependabot.yml`, so this wasn't actually automated. **Fixed**: reworded to "reviewed... as part of our security process. Automated scanning on every change is on our roadmap, not yet in place." — honest about current state.
- `/privacy`'s "What we collect" section didn't mention that UTM/campaign attribution (from the Phase 11 work) is also stored alongside form submissions when present. **Fixed**: added a sentence disclosing this, verified against `src/lib/attribution.ts` (client-side only until form submit, first-touch, no third-party transmission) and the migration that added the columns.
- Re-verified after both fixes: `tsc` clean, `eslint` 0 new, 86/86 tests, `next build` clean, both pages still prerendered static.

**Process note, separate from the content check above:** the greenlight policy (one phase, explicit owner approval before the next) was still skipped for the whole undocumented batch — that's a process fact this content check doesn't retroactively fix. Content is now verified accurate; it just wasn't approved phase-by-phase as it was built.

### Phase 1 — Routing audit & fix (commit `e240195`)
- **Finding:** the app has a proxy (`src/proxy.ts` → `src/lib/school-slug-routing.ts`) that treats any unrecognized top-level path segment as a school slug and silently rewrites it to `/dashboard`. Without a fix, every new marketing route would have silently rendered the dashboard (then bounced to login) instead of marketing content.
- **Fix:** added the 7 marketing route segments to `NEVER_PREFIX` in `school-slug-routing.ts`. This is the *only* change to existing routing/auth code. `updateSession`/`isProtectedPath`, and every existing protected route's behavior, are untouched — verified with 20 targeted behavioral tests against the real function, plus the full existing suite, plus live-deployment route fetches.

### Phase 2 — Design system (commit `1626ca7`, cleanup in `c30efe4`)
- New marketing-only design tokens in `globals.css`: reuses existing `--brand-navy-*`/`--brand-gold-*` tokens (already in the codebase, previously unused outside the login page), adds `--marketing-blue` (`#0057c7`, sampled directly from the logo's "core" wordmark) and `--marketing-canvas` (`#fcfcfa`). Registered as Tailwind colors (`marketing-navy-*`, `marketing-gold-*`, `marketing-blue`, `marketing-canvas`).
- Type: Inter (display/body) + IBM Plex Mono (structural/data labels only) — both already self-hosted in the repo, zero new dependencies.
- New components in `src/components/marketing/`: `button.tsx` (MarketingButton — deliberately separate from `components/ui/button.tsx` so the app's shared button is never touched), `eyebrow.tsx`, `section.tsx` (enforces canvas/navy alternating rhythm — never two dark sections in a row), `nav.tsx`, `footer.tsx`, `dashboard-frame.tsx` (signature visual element — a navy/gold "marketing stage" containing an honest reconstruction of the real product UI using unmodified app tokens/components).
- New route group `src/app/(marketing)/layout.tsx` — nav + footer wrapper, deliberately has no Supabase session check.
- A temporary `/style-guide` QA page was built, reviewed on a live preview, then deleted along with its routing allow-list entry (this is done — don't recreate it).

### Phase 3 — Homepage (commit `4dc573a`)
- Replaced `src/app/page.tsx`'s `redirect("/dashboard")` with the real homepage at `src/app/(marketing)/page.tsx` (same URL — route groups don't change the path). This was the highest-risk single file change in the whole project; it's done and verified.
- New components: `feature-card.tsx` (module/role/trust card), `reveal.tsx` (dependency-free scroll-reveal using IntersectionObserver, respects `prefers-reduced-motion`).
- Homepage sections, built in this order: hero (value prop, Book a Demo / Explore CTAs, Dashboard Frame visual) → problem/value proposition → platform module overview (10 real modules, matched to actual `(app)/` folders) → outcomes → AI & Automation (3 real, codebase-verified features: AI report-card comments, WhatsApp parent communication, timetable automation — explicitly framed as live, not roadmap) → role-based value (7 roles) → trust/proof points (M-Pesa integration, per-school data isolation via RLS, offline resilience, dual grading models — real technical differentiators, zero invented stats/logos/testimonials) → final CTA.
- Verified on a live preview deployment: `/` renders correctly and is prerendered static, `/login` unchanged, unauthenticated `/dashboard` still correctly redirects to `/login`.

> **Note on this doc's history:** this file was not updated after Phases 4–6 were built in earlier sessions (it still said "Phases 1–3" until this Phase 7 session found and corrected it by reading actual commit history). If you're a future session: trust `git log`, not just this doc's own claims about what's current — then fix the doc if it's stale, like this note is doing now.

### Phase 4 — Platform page (commit `57945cf`)
- `/platform` built covering EduCore's full module set, matched against the real `(app)/` folder list. New component: `module-block.tsx`. Reuses/extends the `DashboardFrame` pattern selectively rather than on every module.

### Phase 5 — Solutions page (commit `b286e30`)
- `/solutions` built: role-based, outcome-focused sections for School Owners, Principals, Administrators, Teachers, Finance Teams, Parents, and Students (expands the homepage's compressed role grid). New components: `role-panel.tsx`, `mini-frame.tsx`.

### Phase 6 — AI & Automation page (commit `638fa73`)
- `/ai-automation` built as the deeper version of the homepage's AI section, with live-vs-planned capabilities clearly distinguished per the ground rules.

### Phase 7 — Pricing page (`/pricing`) — this session
- **Pricing model found to already exist, live in production** — not invented, not supplied verbally by the owner, but discovered by querying the real `subscription_plans` table in Supabase (project `alzqlvfaftwegptfbfej`), which is actively used by `school_subscriptions` for real billing. Three active plans: **Starter** (≤200 students, modules: core/academics/finance), **Growth** (≤800 students, adds payroll/library/transport/boarding/inventory/communication), **Enterprise** (no student cap, all modules + AI), all billed `termly`, all priced `price_per_student_kes` (a real numeric rate exists per plan).
- **Owner decision requested and given, before writing any copy:** show tier names, student caps, module coverage, and billing cadence (termly, per-student) publicly — but **do not show the exact KES rates**. Implemented exactly that; no pricing numbers appear on the page.
- New component: `pricing-card.tsx` — deliberately has a "Talk to us" price slot instead of a number, sized so a real rate could be dropped in later without a redesign, per the original Phase 7 roadmap note.
- Page sections: hero → 3 plan cards (Starter/Growth/Enterprise, real module lists, no numeric prices) → "how pricing works" (per-student, termly billing — real structural facts, not numbers) → final CTA to `/contact` (not yet built — same as existing nav/footer links to `/pricing` before this phase; `/contact` will resolve once Phase 8 ships).
- Verified: `tsc --noEmit` clean, `eslint` 0 new errors/warnings (same 5 pre-existing warnings as always), full test suite 86/86 passing, `next build` clean with `/pricing` prerendered static and zero route collisions.
- **Live preview-deployment fetch: done.** `/pricing` on the branch's live preview returns 200, is server-marked `x-nextjs-prerender: 1` (static), has the correct title/description, and the rendered HTML confirms no KES numbers anywhere — only "Talk to us" plus tier names/caps/modules/billing cadence. `/login` re-checked on the same preview and unaffected.

### Phase 7.5 — Solutions page correction (commit `a01ae6c`, by the concurrent Phase 8 session)
- Fixed an inaccurate claim: the Students section had stated EduCore doesn't give students their own login, which was wrong — `portal/page.tsx` has a real `roleName === "student"` branch with a scoped view (timetable, fee balance, attendance rate, latest result, homework). Corrected the headline/outcome list to describe the real, verified student portal instead, including that PT-meeting booking is deliberately parent-only (confirmed via the `roleName === "parent"` gate).

### Phase 8 — About & Contact (commit `dbd8d1b`, by the concurrent session; migration filename fixed in `7af5d24`)
- **New `/about` page:** mission/vision/who-it's-for, company-level copy grounded in problems already established as real across Phases 3–6 (fragmented spreadsheets/WhatsApp/paper registers, M-Pesa, offline resilience, dual grading, multi-campus). No invented founding story, team bios, funding, or awards.
- **New `/contact` page:** lead-gen demo-request form (name, school, role, email, phone, student count, message), via `demo-request-form.tsx` (client component, React 19 `useActionState`) and `contact/actions.ts` (server action, imports but doesn't modify the existing Supabase server client).
- **Backend decision — confirmed with the owner, not assumed:** a single new table, `marketing_demo_requests`, in the same Supabase project (`alzqlvfaftwegptfbfej`), isolated from the app's tenant schema. RLS enabled with exactly one policy — INSERT for anon+authenticated, `check(true)` — no SELECT/UPDATE/DELETE policy for any role, confirmed via `pg_policy`. Submissions are visible to the owner only via Supabase Studio (service-role access), not through the app or the public site; no new page was added under `(app)/` for this, per the ground rule against modifying that route group.
- Verified (by that session): `tsc --noEmit` clean, `eslint` 0 new errors, full test suite passing (86/86), full `next build` clean with `/about`/`/contact` both prerendered static, zero route collisions, and the new table/RLS confirmed directly via SQL against the live project.

### Phase 9 — FAQ & SEO (commit `46b56bb`) — this session, rebased onto Phase 8 after it landed mid-session
- **New `/faq` page**, 10 Q&A pairs, plus FAQPage JSON-LD structured data that mirrors the visible copy exactly (so it can't say anything the page doesn't). Every answer restates a fact already codebase-verified in an earlier phase (RLS isolation, offline queueing, dual grading models, M-Pesa — Phase 3; AI-is-Enterprise-only — the `subscription_plans.features` jsonb queried in Phase 7; multi-campus — the real `campuses` module, Phase 4) or the pricing structure from Phase 7 — nothing new was asserted.
- **Site-wide SEO:** new `src/lib/site.ts` (`SITE_URL` = `https://educore-beige.vercel.app`, the project's real current Vercel-assigned production alias — confirmed via `Vercel:get_project`; there's no purchased custom domain yet, so this isn't invented, but it should be swapped to a real domain in this one file if one gets bought later). `metadataBase` + default Open Graph/Twitter tags added to the root layout. Every marketing page's `metadata` export — the original 5 from Phases 3–7, plus `/about` and `/contact` once Phase 8 landed mid-session — got Open Graph/Twitter/canonical metadata added; the homepage got an explicit `metadata` export for the first time (it had been silently inheriting the generic root-layout fallback).
- **`sitemap.ts`** lists all 8 routes that currently render real content, including `/about` and `/contact` (added after this session rebased onto Phase 8 — the file originally excluded them, written before Phase 8 had landed, then updated once it had). **`robots.ts`** disallows `/dashboard`, `/login`, `/parent-login` (real authenticated-only entry points); `/signup` is deliberately allowed since it's a real public "start a school" page, not gated. Both routes are already excluded from `proxy.ts`'s matcher, confirmed by their appearing in the build output as prerendered — no `NEVER_PREFIX` entry was needed.
- **Heading hierarchy audit:** every marketing page (all 7, including Phase 8's About/Contact) already had exactly one `<h1>` — confirmed by grep, nothing needed fixing.
- **No OG image** was added — the only real image asset available (`educore-logo-lockup.png`) is a wide wordmark (1431×417, ~3.4:1) that would get cropped at the standard 1200×630 (1.91:1) Open Graph ratio, so a proper social-share image would need actual design work rather than reusing the logo as-is. Flagging this rather than guessing; can be picked up as a small follow-up if the owner wants one.
- Verified: `tsc --noEmit` clean, `eslint` 0 new errors/warnings (same 5 pre-existing warnings), full test suite 86/86 passing, `next build` clean with `/faq`, `/about`, `/contact`, `/robots.txt`, `/sitemap.xml` all prerendered static and zero route collisions. Generated `sitemap.xml`/`robots.txt` output inspected directly from the build to confirm correct URLs/rules, not just that the build succeeded.
- **Live preview-deployment fetch: done.** `/faq` returns 200, prerendered static, correct title/description/OG/Twitter/canonical, all 10 Q&A pairs render correctly, FAQPage JSON-LD present and matches the visible copy exactly. `/about` and `/contact` re-verified on the same rebased preview — both 200, prerendered, correct OG/canonical metadata, contact form renders. `/sitemap.xml` confirmed live with all 8 real routes; `/robots.txt` confirmed live with the correct disallow rules. `/login` re-checked and unaffected (only picks up the new app-wide OG/Twitter fallback, which is harmless and expected).

### Current file inventory (all on `feature/marketing-site`, none on `main`)
```
MODIFIED:
  src/lib/school-slug-routing.ts       (NEVER_PREFIX +7 entries)
  src/app/globals.css                  (+marketing tokens, +2 font weights)
  src/app/layout.tsx                   (Phase 9: metadataBase, default OG/Twitter)
  src/app/(marketing)/page.tsx          (Phase 9: added explicit metadata export)
  src/app/(marketing)/platform/page.tsx        (Phase 9: OG/Twitter/canonical added)
  src/app/(marketing)/solutions/page.tsx       (Phase 7.5 fix + Phase 9: OG/Twitter/canonical added)
  src/app/(marketing)/ai-automation/page.tsx   (Phase 9: OG/Twitter/canonical added)
  src/app/(marketing)/pricing/page.tsx         (Phase 9: OG/Twitter/canonical added)
  src/app/(marketing)/about/page.tsx           (Phase 9: OG/Twitter/canonical added)
  src/app/(marketing)/contact/page.tsx         (Phase 9: OG/Twitter/canonical added)

DELETED:
  src/app/page.tsx                     (old redirect("/dashboard"))

ADDED:
  src/app/(marketing)/layout.tsx
  src/app/(marketing)/page.tsx          (homepage)
  src/app/(marketing)/platform/page.tsx
  src/app/(marketing)/solutions/page.tsx
  src/app/(marketing)/ai-automation/page.tsx
  src/app/(marketing)/pricing/page.tsx
  src/app/(marketing)/about/page.tsx           (Phase 8)
  src/app/(marketing)/contact/page.tsx         (Phase 8)
  src/app/(marketing)/contact/actions.ts       (Phase 8)
  supabase/migrations/20260828203537_marketing_demo_requests.sql  (Phase 8)
  src/components/marketing/button.tsx
  src/components/marketing/eyebrow.tsx
  src/components/marketing/section.tsx
  src/components/marketing/nav.tsx
  src/components/marketing/footer.tsx
  src/components/marketing/dashboard-frame.tsx
  src/components/marketing/feature-card.tsx
  src/components/marketing/reveal.tsx
  src/components/marketing/module-block.tsx
  src/components/marketing/role-panel.tsx
  src/components/marketing/mini-frame.tsx
  src/components/marketing/pricing-card.tsx
  src/app/(marketing)/faq/page.tsx     (Phase 9)
  src/app/sitemap.ts                   (Phase 9)
  src/app/robots.ts                    (Phase 9)
  src/lib/site.ts                      (Phase 9)
```

## 4. Design system reference (for consistency in later phases)

| Token | Hex | Use |
|---|---|---|
| Navy Ink | `#0A1730` | primary dark surface (`marketing-navy-900`) |
| Navy Deep | `#060C1F` | deepest shade, footer (`marketing-navy-950`) |
| Gold Signal | `#D9A627` | CTAs, sparingly (`marketing-gold-500`) |
| Gold Soft | `#F2D182` | hairlines/accents on dark (`marketing-gold-300`) |
| Core Blue | `#0057C7` | supporting accent, sampled from logo (`marketing-blue`) |
| Canvas | `#FCFCFA` | light content background (`marketing-canvas`) |

Type: **Inter** (headline/body, weights 400/500/600/700/800 available), **IBM Plex Mono** (structural/data labels only — eyebrows, stat numbers — weights 400/500/600 available). Both via `@fontsource`, already imported in `globals.css`.

Layout rhythm: `Section` component alternates `tone="canvas"` / `tone="navy"`, never two navy sections back to back. Signature visual: `DashboardFrame` (navy/gold stage, real app UI tokens inside) — use meaningfully, don't overuse across pages.

## 5. Ground rules for every remaining phase (carried over, still apply)

- **Never invent:** no fake customer logos, testimonials, statistics, awards, or adoption numbers, anywhere.
- **Verify before claiming:** before writing copy about a feature/module, grep the actual codebase to confirm it exists (see how AI & Automation section was verified — WhatsApp inbox, AI report-card comments, timetable auto-generate were all confirmed present before being described as live).
- **Never modify:** anything under `(app)/`, `lib/supabase/`, `supabase/` (migrations/RLS), `proxy.ts` itself (only `school-slug-routing.ts`'s `NEVER_PREFIX` list may be extended, additively, for new public routes), `vercel.json`, or existing CSP logic.
- **Every new marketing route must be added to `NEVER_PREFIX`** in `src/lib/school-slug-routing.ts` before it will render for anonymous visitors — this is the recurring gotcha this codebase has (see Phase 1). Check this first for every new page.
- **Verification bar for every phase:** `tsc --noEmit` clean, `eslint` clean (0 new errors — 5 pre-existing warnings in unrelated files are expected and not yours to fix), full existing test suite passing, full `next build` with zero route collisions, and — since there's no browser click-through tool — a live Vercel preview-deployment fetch confirming actual rendered behavior, not just code review.
- **Greenlight policy:** implement one phase, verify it, report findings + any conflicts, and stop for explicit owner approval before starting the next phase. Do not bundle multiple phases into one unreviewed push.
- **Never push to `main`.** Keep working on `feature/marketing-site` (or a sub-branch off it) until Phase 10 is explicitly signed off.
- **PAT handling:** a GitHub PAT is provided fresh each session for push access. Use it only for that session's git operations, then immediately run `git remote set-url origin https://github.com/jamesmaina263-debug/Educore.git` to strip it back to a plain HTTPS remote. Never store it.
- **Check for drift** (`git ls-remote origin`) before pushing — this repo has multiple sessions/branches in flight.

## 6. Complete roadmap — remaining phases

**Phases 1–9 (this doc's original numbering) are done and verified.** The additional undocumented work from Section 3a has now had its content independently verified (2 issues found and fixed — see Section 3a) and its build re-confirmed clean. **What's genuinely still missing is a real, owner-approved Phase 10**: not content accuracy anymore, but the visual/UX/responsive/integration pass below, plus the owner's explicit sign-off before merge.

### Phase 10 — Final UX & quality audit
Full pass across **everything currently on the branch**, not just the original Phases 1–9:
- Visual: premium feel, consistent spacing/typography/colour, balanced sections.
- UX: intuitive nav, obvious CTAs, consistent cross-page patterns, good mobile interactions.
- Technical: no broken routes/console errors/broken imports/duplicated components; confirm zero DB/API/auth changes beyond the Phase 1 `NEVER_PREFIX` addition and whatever Phase 8's contact-form backend decision required.
- Responsive: mobile/tablet/laptop/large desktop.
- Content: re-verify no fake statistics/testimonials/claims crept in anywhere, no placeholder text left in, no planned feature presented as live.
- **Final integration check:** explicitly re-confirm the existing EduCore application behaves exactly as it did before this project started (repeat the Phase-1-style live-deployment verification across the full existing route set, not just spot checks).
- Only after this phase is signed off does this branch get merged to `main`.

---

**For the next session, in one sentence:** Phases 1–9 (this doc's numbering) are done and verified, but substantial additional undocumented work also landed on the branch afterward (new legal/security/finance pages, analytics/attribution, content additions — see Section 3a) that was never content-verified or explicitly approved phase-by-phase; the branch was also rebased onto `main` (safe, nothing lost, but re-sync via `git reset --hard origin/feature/marketing-site` if your clone predates this) — current full build is confirmed clean as of 2026-08-29, but a genuine, owner-approved Phase 10 final audit (including content-verifying Section 3a's additions) still needs to happen before merge to `main`.
