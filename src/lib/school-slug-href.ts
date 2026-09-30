import { APP_ROUTE_SEGMENTS } from "@/lib/app-route-segments";

// Client-safe helpers for building slug-prefixed staff-app URLs (e.g. "/gititu-high-school/students").
//
// Why this exists: proxy.ts answers a GET for a bare staff-app path ("/students") with a 307 to
// "/{slug}/students" whenever the browser has the edu_slug cookie -- a full extra network round
// trip plus a second pass through the proxy's session check, on every sidebar click and every
// sidebar prefetch. Linking straight to the slugged URL lands on exactly the same final URL
// without the hop. See resolveSlugRouting() in school-slug-routing.ts: this mirrors its rules, so
// a link is only prefixed in the cases where the proxy would have redirected anyway.

// Same shape createSchool/slugify produce; anything else (a tampered or malformed cookie) is
// ignored and links fall back to bare paths, i.e. exactly today's behaviour.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

// "admin" is in APP_ROUTE_SEGMENTS for bookkeeping but is never slug-prefixed (NEVER_PREFIX wins
// in resolveSlugRouting), so it must not be prefixed here either.
function isSluggable(firstSegment: string | undefined): boolean {
  return !!firstSegment && firstSegment !== "admin" && APP_ROUTE_SEGMENTS.has(firstSegment);
}

/** Returns a cookie value only if it looks like a real school slug. */
export function sanitizeSchoolSlug(raw: string | undefined | null): string | undefined {
  return raw && SLUG_PATTERN.test(raw) ? raw : undefined;
}

/** "/students" -> "/{slug}/students" when a slug is known and href is a staff-app route; otherwise unchanged. */
export function withSchoolSlug(slug: string | undefined, href: string): string {
  if (!slug || !href.startsWith("/")) return href;
  const first = href.split(/[/?#]/).filter(Boolean)[0];
  // Already slug-prefixed, or not a staff-app route: leave exactly as given.
  if (!isSluggable(first)) return href;
  return `/${slug}${href}`;
}

/** "/{slug}/students" -> "/students" (for active-link matching); paths without the prefix are unchanged. */
export function stripSchoolSlug(slug: string | undefined, pathname: string): string {
  if (!slug) return pathname;
  const prefix = `/${slug}`;
  if (pathname === prefix) return "/";
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
}
