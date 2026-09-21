import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { BLOG_POSTS } from "@/lib/blog-posts";

// Lists every route that currently renders real marketing content.
// /about and /contact were added here once Phase 8 landed (it shipped
// after this file was first written, in a concurrent session) -- keep
// this in sync with whatever routes exist whenever a new phase adds one.
//
// changeFrequency added in the SEO/analytics pass: "weekly" for pages
// likely to get copy iterations (home, pricing, high-intent landing pages),
// "monthly" for stable feature/legal pages -- a hint to crawlers, not a
// guarantee, and costs nothing to include accurately.
const ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/platform", priority: 0.8, changeFrequency: "monthly" },
  { path: "/solutions", priority: 0.8, changeFrequency: "monthly" },
  { path: "/student-management-system", priority: 0.7, changeFrequency: "monthly" },
  { path: "/cbc-school-management", priority: 0.7, changeFrequency: "monthly" },
  { path: "/school-attendance-management", priority: 0.7, changeFrequency: "monthly" },
  { path: "/parent-communication", priority: 0.7, changeFrequency: "monthly" },
  { path: "/student-performance-appraisal", priority: 0.7, changeFrequency: "monthly" },
  { path: "/teacher-performance-management", priority: 0.7, changeFrequency: "monthly" },
  { path: "/ai-automation", priority: 0.7, changeFrequency: "monthly" },
  { path: "/finance-fees", priority: 0.7, changeFrequency: "monthly" },
  { path: "/security", priority: 0.6, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "weekly" },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.7, changeFrequency: "monthly" },
  { path: "/faq", priority: 0.6, changeFrequency: "monthly" },
  { path: "/blog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];

// Blog post URLs come from the BLOG_POSTS registry, not hardcoded entries
// above: the registry is the file a new post already has to be added to for
// the /blog index, so deriving from it means a post can't be published and
// silently left out of the sitemap (which had happened -- the
// student-performance-appraisal post was live and missing from here).
const BLOG_ROUTES: typeof ROUTES = BLOG_POSTS.map((post) => ({
  path: `/blog/${post.slug}`,
  priority: 0.6,
  changeFrequency: "monthly",
}));

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [...ROUTES, ...BLOG_ROUTES].map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    priority,
    changeFrequency,
  }));
}
