// Top-level path segments served by src/app/(marketing). Keep in sync with
// that folder's page.tsx list (see also NEVER_PREFIX in
// school-slug-routing.ts, which serves a related but broader purpose).
//
// "" represents the marketing homepage itself ("/").
const MARKETING_TOP_LEVEL_SEGMENTS = new Set([
  "",
  "about",
  "ai-automation",
  "contact",
  "faq",
  "finance-fees",
  "platform",
  "pricing",
  "privacy",
  "security",
  "solutions",
  "terms",
]);

// True for the marketing homepage and any of its top-level pages (e.g.
// "/pricing", "/about"), false for everything else (the staff app, parent
// portal, /login, /apply/[slug], API routes, etc.). Pathname-prefix based
// only -- deliberately doesn't need to know about nested marketing routes
// since none exist today (see the flat list above).
export function isMarketingPath(pathname: string): boolean {
  const first = pathname.split("/").filter(Boolean)[0] ?? "";
  return MARKETING_TOP_LEVEL_SEGMENTS.has(first);
}
