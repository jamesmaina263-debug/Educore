import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Deliberately lists only routes that currently render real marketing
// content, as of this Phase 9 session. /about and /contact are approved
// future routes (already in NEVER_PREFIX) but Phase 8 -- being built in a
// concurrent session as of this writing -- hasn't landed them yet, so
// listing them here would put 404s in the sitemap. Whoever finishes
// Phase 8 should add "/about" and "/contact" entries below once those
// pages exist; same for any route added in Phase 10 or later.
const ROUTES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/platform", priority: 0.8 },
  { path: "/solutions", priority: 0.8 },
  { path: "/ai-automation", priority: 0.7 },
  { path: "/pricing", priority: 0.8 },
  { path: "/faq", priority: 0.6 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    priority,
  }));
}
