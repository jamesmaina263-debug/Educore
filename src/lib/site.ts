// Canonical production URL for the marketing site's SEO metadata
// (Open Graph tags, sitemap.ts, robots.ts). Vercel's Domains config
// (checked live, Aug 2026) 308-redirects the bare "educoreafrica.com" to
// "www.educoreafrica.com" -- the www version is what actually serves the
// site, so it's the one search engines and social scrapers should be told
// is canonical. Using the bare domain here would mean every crawler makes
// an extra redirect hop, and OG/canonical tags would point at a URL that
// never actually renders content.
// If the domain or its redirect direction ever changes, update this one
// constant and every OG tag / sitemap entry / robots rule picks it up
// automatically.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.educoreafrica.com";

export const SITE_NAME = "EduCore";
