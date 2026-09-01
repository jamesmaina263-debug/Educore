# SEO & Analytics Implementation — EduCore Africa (educoreafrica.com)

Built 2026-08-30/31. Kenya is the sole target market for this phase — see the project brief
for the full 18-section scope.

**Read this before extending it further:** an earlier pass on this same task built a full
GTM/GA4 integration from scratch on a branch that turned out to be based on a stale `main`.
By the time it was ready to merge, `main` had independently grown a more complete GTM/GA4
system of its own (live container `GTM-MGV2XHBB`, a server-side GA4 reporting dashboard at
`src/lib/ga4.ts`, CTA-source attribution) — including a documented fix for a real privacy
incident (GTM briefly loaded site-wide, exposing analytics/ad tags to pages with real student
PII; see the comment in `src/app/layout.tsx`). That earlier branch was **discarded, not
merged** — merging it would have silently reintroduced that exact incident. This document
only describes what actually landed on `main`.

## What this phase actually added

### Technical SEO
- **`src/app/robots.ts`** — disallow list expanded from 3 entries (`/dashboard`, `/login`,
  `/parent-login`) to the full set of authenticated `(app)` module paths (~21 total). Audit
  finding: every folder under `src/app/(app)/` shares the site's top-level URL space (route
  groups don't add a path segment), and each page's own data loader redirects anonymous
  visitors to `/login` rather than the route group's `layout.tsx` doing it — so none of those
  ~18 extra paths were actually blocked from crawling before this. No runtime auth behavior
  changed; this only stops Googlebot wasting crawl budget on redirect chains.
- **Homepage + `/platform` H1s** — both had strong `<title>` tags already targeting Kenya
  keywords, but zero keyword signal in their H1 (the single most SEO-weighted on-page
  element). Fixed:
  - Home: "Run your entire school from one intelligent platform" → "School management
    software built for Kenyan schools."
  - `/platform`: "Every part of running a school, mapped to a real module" → "The school
    management system platform, mapped to every real module."

### New Kenya-intent landing pages (4)

| Page | Targets | Grounded in |
|---|---|---|
| `/student-management-system` | "student management system Kenya," "student information system Kenya" | `(app)/students/[id]/*-tab.tsx` (discipline, medical, guardians, certificates, id-card) |
| `/cbc-school-management` | "CBC school management system" | `grading_scales`/`grading_scale_bands` schema (`model_type: numeric \| cbc`), the existing NEMIS claim already on `/solutions` |
| `/school-attendance-management` | "school attendance management system Kenya" | `biometric-kiosk/page.tsx` (guardian SMS, confirmed via its own dry-run toggle), `attendance/actions.ts` (correction/review workflow) |
| `/parent-communication` | "parent communication platform Kenya" | Existing Communication module block, `api/cron/school-comms/route.ts` (newsletter sweep is automatic; fee-threshold alerts are drafted only, human-approved before sending), `portal/page.tsx` |

Every claim on each page was checked against the actual source file before being written, not
assumed from the module name.

**Deliberately not built:** `/school-management-system-kenya` and `/school-fees-management`
— `/platform` and `/finance-fees` already target those exact phrases with real depth (486 and
190 lines respectively); a new page would cannibalize rather than add coverage.
`/school-timetable-management` and `/school-portal` — thin standalone search intent for the
former, and the latter's content (parent login, fee balance, report card, payments) is now
fully covered by `/parent-communication`'s "Parent Portal" module.

Each new page is cross-linked from `/platform`'s relevant section and from the other new
pages, and added to `sitemap.ts`, `src/lib/school-slug-routing.ts`'s `NEVER_PREFIX`
allow-list, and the footer's Product group.

### Analytics: one real gap closed
`main` already tracks the demo-request funnel (`contact_form_submit`, `contact_form_context`,
etc. via GTM) and has a full GA4 reporting dashboard. The one conversion with **no tracking
anywhere**: the self-serve `/signup` "Start a school" flow, which skips the demo entirely.

- **`src/app/signup/layout.tsx`** (new) — loads `GoogleTagManager` (same container,
  `GTM-MGV2XHBB`) for the `/signup` route specifically. It had none before — `/signup` isn't
  wrapped by `(marketing)/layout.tsx` (which loads GTM) and the root layout deliberately
  excludes GTM, but for a different reason: to keep it away from the authenticated `(app)`/
  `(admin)` route groups that render real PII. `/signup` is a public, pre-auth page in the
  same category as `/contact`, so this doesn't reintroduce that risk.
- **`src/app/signup/signup-form.tsx`** — fires `sendGTMEvent({ event: "sign_up" })` once, the
  render after a school account is actually created (`state.success`), matching the existing
  `demo-request-form.tsx` pattern exactly (same `sendGTMEvent` import, same "fires on confirmed
  success, not on click/validation" discipline).

**Manual step to activate:** inside the GTM container, add a GA4 Event tag triggered on the
`sign_up` custom event, and mark it as a GA4 conversion (Admin → Events). Same container
already receiving `contact_form_submit`, so no new container/property needed.

## Verification
`tsc --noEmit`: clean. `eslint`: 0 errors (5 pre-existing warnings, unrelated files,
unchanged). `vitest run`: 98/98 passing. `next build`: clean, all new routes prerendered
static (`○`), zero route collisions.

## Remaining scope — not started
- **Content/blog**: `main` already has one post (`/blog/best-school-management-system-kenya`,
  a buyer's-guide). The brief's other topics ("how schools can automate fee collection," etc.)
  are still unwritten.
- **OG image**: still no 1200×630 social-share asset.
- **Competitor SEO analysis, performance/Core Web Vitals audit, BreadcrumbList/Article
  schema**: not started.
- **Google Search Console**: manual, site-owner action — add `educoreafrica.com` as a
  property, verify via DNS TXT, submit `/sitemap.xml`. No code changes needed;
  `sitemap.ts`/`robots.ts` already emit correct, indexable URLs.
