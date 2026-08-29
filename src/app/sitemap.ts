import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Lists every route that currently renders real marketing content.
// /about and /contact were added here once Phase 8 landed (it shipped
// after this file was first written, in a concurrent session) -- keep
// this in sync with whatever routes exist whenever a new phase adds one.
const ROUTES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/platform", priority: 0.8 },
  { path: "/solutions", priority: 0.8 },
  { path: "/ai-automation", priority: 0.7 },
  { path: "/finance-fees", priority: 0.7 },
  { path: "/security", priority: 0.6 },
  { path: "/pricing", priority: 0.8 },
  { path: "/about", priority: 0.6 },
  { path: "/contact", priority: 0.7 },
  { path: "/faq", priority: 0.6 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    priority,
  }));
}
