import { NextResponse, type NextRequest } from "next/server";
import { SCHOOL_SLUG_COOKIE } from "@/lib/school-slug-cookie";

// Real top-level folders under src/app/(app) -- i.e. every actual staff-app
// route. Used to tell "/dashboard" (a real route, bare/unslugged) apart from
// "/gititu-high-school/dashboard" (a real route, slug-prefixed) so the same
// first path segment can be handled correctly either way. Keep in sync with
// src/app/(app)'s folder list if a new top-level module is ever added.
export const APP_ROUTE_SEGMENTS = new Set([
  "academics", "admin", "admissions", "ai", "announcements", "attendance", "boarding", "campuses",
  "communication", "connect", "dashboard", "discipline", "exams", "finance", "health",
  "homework", "integrations", "inventory", "library", "parents", "payroll", "performance", "pt-meetings",
  "reports", "settings", "staff", "students", "transport",
]);

// Never slug-prefixed: public/marketing pages, the parent/student portal
// (separate login, out of scope for this staff-app change), API routes, and
// the platform super_admin panel (no single school to prefix with).
//
// The trailing group (platform, solutions, ai-automation, pricing, about,
// contact, faq) are the public EduCore marketing site's top-level routes,
// added when that site was introduced. Without this, resolveSlugRouting's
// fallback branch below would treat each of these as an unrecognized
// "school slug" and silently rewrite the request to /dashboard -- the
// marketing pages would never render for an anonymous visitor. This is a
// routing allow-list only: it does not touch updateSession/isProtectedPath
// above, so auth/redirect behavior for every existing protected route is
// unchanged. Keep in sync with src/app/(marketing)'s top-level folder list.
export const NEVER_PREFIX = new Set([
  "api", "apply", "login", "signup", "notifications", "parent-login", "portal", "admin", "change-password",
  "platform", "solutions", "ai-automation", "pricing", "about", "contact", "faq",
  "privacy", "terms", "finance-fees", "security", "blog",
  "student-management-system", "cbc-school-management",
  "school-attendance-management", "parent-communication",
]);

export type SlugRouting = { type: "next" } | { type: "redirect"; url: URL } | { type: "rewrite"; url: URL };

// Pure function (no cookie writes, no response construction) so proxy.ts can
// decide how to combine this with the session-refresh response it already
// has, without either one silently dropping the other's cookies.
//
// `isAuthenticated` comes from the `supabase.auth.getUser()` call
// updateSession() already makes on every request -- this adds no new
// network/DB call, it just threads through a result that was already being
// computed. See the bare-single-segment branch below for why it's needed.
export function resolveSlugRouting(request: NextRequest, isAuthenticated: boolean): SlugRouting {
  const { pathname } = request.nextUrl;
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];

  if (!first || NEVER_PREFIX.has(first)) {
    return { type: "next" };
  }

  if (APP_ROUTE_SEGMENTS.has(first)) {
    // Bare, unslugged request to a real staff-app route (e.g. "/dashboard").
    // Only ever applies to GET (navigation) -- redirecting a POST/Server
    // Action here would be wrong, and none should ever target a bare
    // unslugged path anyway since the page itself was served slug-prefixed.
    // If we know this browser's school (cookie set at login/signup), send it
    // to the slug-prefixed version. If we don't (older session predating
    // this change, or genuinely unauthenticated), fall through unchanged --
    // the page's own auth check still applies either way; this cookie is
    // purely cosmetic for the URL.
    if (request.method !== "GET") return { type: "next" };
    const slug = request.cookies.get(SCHOOL_SLUG_COOKIE)?.value;
    if (!slug) return { type: "next" };

    const target = request.nextUrl.clone();
    target.pathname = `/${slug}${pathname}`;
    return { type: "redirect", url: target };
  }

  // Anything else starting with an unrecognized first segment is treated as
  // "/{slug}/rest-of-path" and rewritten to "/rest-of-path" so the existing
  // route files keep serving it completely unchanged. Deliberately NOT
  // validated against the real school here -- authorization is entirely
  // RLS/auth_school_id()'s job server-side regardless of what's in the URL,
  // so a stale or someone-else's slug in the address bar is a cosmetic
  // mismatch, never a data-access issue.
  //
  // Deliberately method-agnostic (unlike the branch above): a page rendered
  // at "/{slug}/admissions" stays at that URL in the browser, so a Server
  // Action fired from it POSTs to that same slugged URL. If this branch were
  // GET-only, every Server Action / form POST on a slug-prefixed page would
  // 404 (no literal route exists at "/{slug}/admissions") while the page
  // itself loaded fine -- exactly what happened to the admissions delete
  // button: the GET-only restriction that used to guard this whole function
  // let the page render, then broke the first POST anyone actually fired
  // against it.
  const rest = "/" + segments.slice(1).join("/");

  // Bare single-segment request ("/{unrecognized-segment}", nothing after
  // it) -- this is the one shape this function cannot tell apart from a
  // genuinely bogus/mistyped URL, since slugs are deliberately never
  // validated here (see comment above). For an authenticated visitor this
  // is unchanged: send them to /dashboard exactly as before, since RLS
  // decides what they actually see regardless of what the slug text was --
  // a stale/wrong slug in the address bar was already just cosmetic.
  //
  // For an UNAUTHENTICATED visitor, sending them to /dashboard used to mean
  // silently landing on a bare, unbranded /login with no site chrome and no
  // indication anything went wrong -- for a real dead/mistyped link, that's
  // a lost visitor; for a genuine tenant's bare slug URL, they were already
  // blocked either way (this layer never grants access), so nothing about
  // whether the slug is real is gained or lost by *not* special-casing it.
  // Returning "next" here lets Next.js's own router take over: no real page
  // exists at this path, so the site-wide branded not-found.tsx renders --
  // the same 404 every other unmatched route already gets.
  if (rest === "/" && !isAuthenticated) {
    return { type: "next" };
  }

  const rewritten = request.nextUrl.clone();
  rewritten.pathname = rest === "/" ? "/dashboard" : rest;
  return { type: "rewrite", url: rewritten };
}

// Applies a SlugRouting decision on top of an existing response (typically
// updateSession()'s), preserving any Set-Cookie headers that response
// already carries (the refreshed Supabase session cookies) instead of
// dropping them by constructing an unrelated new response.
export function applySlugRouting(routing: SlugRouting, baseResponse: NextResponse): NextResponse {
  if (routing.type === "next") return baseResponse;

  const next = routing.type === "redirect"
    ? NextResponse.redirect(routing.url, 307)
    : NextResponse.rewrite(routing.url);
  baseResponse.cookies.getAll().forEach((c) => next.cookies.set(c));
  return next;
}
