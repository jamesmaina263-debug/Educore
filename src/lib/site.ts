// Canonical production URL for the marketing site's SEO metadata
// (Open Graph tags, sitemap.ts, robots.ts). The custom domain
// "educoreafrica.com" is now live and attached to the Vercel project.
// If the domain ever changes, update this one constant and every OG tag /
// sitemap entry / robots rule picks it up automatically.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://educoreafrica.com";

export const SITE_NAME = "EduCore";
