// Canonical production URL for the marketing site's SEO metadata
// (Open Graph tags, sitemap.ts, robots.ts). This project has no purchased
// custom domain yet -- "educore-beige.vercel.app" is the real current
// production alias (confirmed via the Vercel project's domains list), not
// invented. If a custom domain is bought later, update this one constant
// and every OG tag / sitemap entry / robots rule picks it up automatically.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://educore-beige.vercel.app";

export const SITE_NAME = "EduCore";
