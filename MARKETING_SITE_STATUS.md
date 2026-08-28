# EduCore Marketing Site — Status & Roadmap

**Last updated:** 2026-08-28 (Phase 7)
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

## 3. What's been built so far (Phases 1–7 of 10)

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
- **Not yet done as part of this phase:** live Vercel preview-deployment fetch (this session doesn't have direct browser/preview-URL access yet — see "Open item" below). Do this before considering Phase 7 fully closed, consistent with the verification bar in Section 5.

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
  src/app/(marketing)/platform/page.tsx
  src/app/(marketing)/solutions/page.tsx
  src/app/(marketing)/ai-automation/page.tsx
  src/app/(marketing)/pricing/page.tsx
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

**Phases 4, 5, 6, and 7 are done** — see Section 3 for what was actually built and verified in each. Pricing (Phase 7) is settled: real tier names/caps/modules shown, exact KES rates deliberately withheld per owner decision — don't re-ask this or re-litigate it in Phase 8+.

**Open item carried forward from Phase 7:** a live Vercel preview-deployment fetch for `/pricing` still needs to happen before Phase 7 is fully closed out (this session verified everything except that — no preview-URL access available). Whoever does Phase 8 should either do this first, or explicitly flag it's still outstanding when reporting to the owner.

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

**For the next session, in one sentence:** Phases 1–7 (routing fix, design system, homepage, platform, solutions, AI & automation, pricing) are done and verified on branch `feature/marketing-site` — pricing intentionally shows no KES numbers per owner decision, and Phase 7's live-preview fetch is still outstanding — start at Phase 8 (About & Contact), follow the ground rules in Section 5, and do not merge to `main` until Phase 10 is signed off.
