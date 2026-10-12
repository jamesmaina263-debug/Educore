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

// Public profiles that represent this business, used for the Organization
// schema's `sameAs`. Only add a URL here once it is a real, live profile for
// EduCore -- `sameAs` is a claim to search engines that these pages are the
// same entity as the website. Use each profile's canonical URL, not a
// share/short link (those are redirects and not stable entity identifiers).
export const SOCIAL_PROFILES = [
  "https://www.facebook.com/profile.php?id=61593117913242",
  // Google Business Profile ("Educore", service-area business, Kenya).
  // Stable CID form of the Maps listing; resolved from the owner's
  // maps.app.goo.gl share link (place id ...:0x53a3aa2795950541).
  "https://maps.google.com/?cid=6026847813341873473",
];

// Public business phone, identical to the number on /contact, the footer
// WhatsApp link and the Google Business Profile -- keep all three in sync.
export const SITE_PHONE = "+254702904562";
