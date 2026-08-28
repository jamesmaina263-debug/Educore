# EduCore Marketing Site — Status & Roadmap

**Last updated:** 2026-08-28
**Branch:** `feature/marketing-site` — **NOT merged to `main`**. Merge only after Phase 10 (final audit) is complete and explicitly approved by the project owner.
**Live preview (latest):** deploys automatically from this branch on every push, via Vercel's GitHub integration. Get the current URL from Vercel → Deployments → filter by branch `feature/marketing-site`, or ask whichever Claude session is active to fetch the latest one. This is a preview deployment (`target: null`), not production — it never affects the live site.

If you are a Claude session picking this up fresh: **read this whole document before writing any code.** It tells you what already exists, what's already been decided, and exactly what's left. Re-doing anything below wastes the user's time and risks conflicting with work already reviewed and approved.

---

## 1. What this project is

A public marketing website for EduCore (a school management SaaS), added to the *same* Next.js app/repo as the existing authenticated product (`jamesmaina263-debug/Educore`), living alongside it without modifying its functionality, auth, database, or RLS.

## 2. Decisions already made and approved — do not re-litigate these

| Decision | What was decided |
|---|---|
| Routing | `/` = marketing homepage (not a redirect to `/dashboard`). `/platform`, `/solutions`, `/ai-automation`, `/pricing`, `/about`, `/contact`, `/faq` = marketing pages. All existing app routes (`/login`, `/dashboard`, everything under the `(app)` route group) unchanged. |
| Brand colours | Navy, gold, and blue (sampled from the actual logo), **not green**. See token list in Section 4. |
| AI page route name | `/ai-automation`, not `/ai` — `/ai` already exists as a real authenticated module (`(app)/ai/`) and would be a build-breaking collision. |
| Content honesty | Every module, AI feature, and "why EduCore" claim on the site must correspond to something that actually exists in the codebase — verified by grep, not assumed. No invented statistics, testimonials, customer logos, or planned-but-unbuilt features presented as live. |
| Process | Greenlight policy: one phase built and verified at a time, explicit owner sign-off before the next phase starts. |
| Merge policy | This branch is merged to `main` only when the entire site (all phases below) is complete, tested, and the owner has said so explicitly. |

## 3. What's been built so far (Phases 1–3 of 10)

All of this is committed to `feature/marketing-site`, verified (typecheck + lint + full existing test suite + full production build + live preview-deployment fetches confirming actual runtime behavior, not just code review), and reviewed/approved by the project owner at each step.

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

### Current file inventory (all on `feature/marketing-site`, none on `main`)
```
MODIFIED:
  src/lib/school-slug-routing.ts       (NEVER_PREFIX +7 entries)
  src/app/globals.css                  (+marketing tokens, +2 font weights)

DELETED:
  src/app/page.tsx                     (old redirect("/dashboard"))

ADDED:
  src/app/(marketing)/layout.tsx
  src/app/(marketing)/page.tsx          (homepage)
  src/components/marketing/button.tsx
  src/components/marketing/eyebrow.tsx
  src/components/marketing/section.tsx
  src/components/marketing/nav.tsx
  src/components/marketing/footer.tsx
  src/components/marketing/dashboard-frame.tsx
  src/components/marketing/feature-card.tsx
  src/components/marketing/reveal.tsx
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

### Phase 4 — Platform page (`/platform`)
Dedicated page covering EduCore's full module set (not just the 10 highlighted on the homepage — check `(app)/` for the complete list: academics, admin, admissions, ai, attendance, boarding, campuses, communication, dashboard, discipline, exams, finance, health, homework, integrations, inventory, library, parents, payroll, performance, pt-meetings, reports, settings, staff, students, transport — decide which of these are marketing-relevant vs. internal-only). For each module shown: what it does, who uses it, problem solved, key capabilities, a relevant UI visual (reuse/extend `DashboardFrame` pattern where it fits, don't overuse the exact same frame every time). Add `platform` is already in `NEVER_PREFIX` — no routing change needed, just build the page.

### Phase 5 — Solutions page (`/solutions`)
Role-based solution pages/sections for School Owners, Principals, Administrators, Teachers, Finance Teams, Parents, Students — outcome-focused (not feature lists). The homepage's role grid (Section 8 of the homepage) is a compressed preview of this; this phase expands each role into real depth. `solutions` already in `NEVER_PREFIX`.

### Phase 6 — AI & Automation page (`/ai-automation`)
Deeper version of the homepage's AI section. **Must clearly distinguish live vs. planned/future capabilities** — the homepage intentionally only shows 3 confirmed-live features; this page can discuss direction/roadmap too, but any forward-looking claim must be explicitly labeled as not-yet-available. Verify anything new against the codebase before writing about it. `ai-automation` already in `NEVER_PREFIX`.

### Phase 7 — Pricing page (`/pricing`)
No invented pricing numbers unless the owner supplies a real, confirmed pricing model. Default to a "Book a Demo / Talk to EduCore" structure with placeholders, built so real pricing tiers can be dropped in later without a redesign. `pricing` already in `NEVER_PREFIX`.

### Phase 8 — About & Contact (`/about`, `/contact`)
About: mission, vision, what problem EduCore solves, why it exists — company-level, not product-feature copy. Contact: lead-gen demo-request form (name, school, role, email, phone, student count, message). **Before wiring the form to a database:** confirm with the owner whether to (a) add a single new table in the *same* Supabase project (`alzqlvfaftwegptfbfej`) with its own tight, insert-only-from-anon RLS, isolated from the app's real schema, or (b) route it elsewhere entirely (email via an Edge Function, a form service). This was flagged as an open decision earlier in the project — don't assume, ask. If backend isn't ready yet, build the UI with a clearly marked integration point rather than guessing. `about` and `contact` already in `NEVER_PREFIX`.

### Phase 9 — FAQ & SEO (`/faq` + site-wide)
FAQ page/section. Site-wide SEO fundamentals: per-page titles/descriptions (root layout currently has a generic "EduCore" title/description that's fine as a fallback, but marketing pages should have their own via each page's `metadata` export), Open Graph tags, semantic HTML/heading hierarchy, descriptive alt text, `sitemap.ts`/`robots.ts` (note: these paths are already excluded from the proxy's matcher, so no `NEVER_PREFIX` entry needed for them). Optimize for the search terms listed in the original brief without keyword stuffing. `faq` already in `NEVER_PREFIX`.

### Phase 10 — Final UX & quality audit
Full pass across everything built in Phases 1–9:
- Visual: premium feel, consistent spacing/typography/colour, balanced sections.
- UX: intuitive nav, obvious CTAs, consistent cross-page patterns, good mobile interactions.
- Technical: no broken routes/console errors/broken imports/duplicated components; confirm zero DB/API/auth changes beyond the Phase 1 `NEVER_PREFIX` addition and whatever Phase 8's contact-form backend decision required.
- Responsive: mobile/tablet/laptop/large desktop.
- Content: re-verify no fake statistics/testimonials/claims crept in anywhere, no placeholder text left in, no planned feature presented as live.
- **Final integration check:** explicitly re-confirm the existing EduCore application behaves exactly as it did before this project started (repeat the Phase-1-style live-deployment verification across the full existing route set, not just spot checks).
- Only after this phase is signed off does this branch get merged to `main`.

---

**For the next session, in one sentence:** Phases 1–3 (routing fix, design system, homepage) are done, verified, and owner-approved on branch `feature/marketing-site`; start at Phase 4 (Platform page), follow the ground rules in Section 5, and do not merge to `main` until Phase 10 is signed off.
