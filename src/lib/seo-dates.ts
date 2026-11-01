// Real "last meaningfully changed" dates for the static marketing routes,
// used as <lastmod> in sitemap.ts.
//
// Why this exists: sitemap.ts previously stamped `new Date()` on every URL,
// so every page looked freshly modified on every crawl. Crawlers learn to
// ignore a lastmod that is always "now", which defeats the point of
// sending one. Dates here are ISO (YYYY-MM-DD) and only move when the
// page's content actually changes -- bump the matching entry in the same PR
// that changes the page. Blog posts don't need an entry: sitemap.ts derives
// theirs from BLOG_POSTS[].publishedOn.
//
// Initial values come from `git log -1 --format=%cs` on each page file.
export const PAGE_LAST_MODIFIED: Record<string, string> = {
  "/": "2026-10-05",
  "/platform": "2026-10-05",
  "/solutions": "2026-10-05",
  "/student-management-system": "2026-10-05",
  "/cbc-school-management": "2026-10-05",
  "/school-attendance-management": "2026-10-05",
  "/parent-communication": "2026-10-05",
  "/student-performance-appraisal": "2026-10-05",
  "/teacher-performance-management": "2026-10-11",
  "/ai-automation": "2026-10-05",
  "/finance-fees": "2026-10-05",
  "/security": "2026-10-05",
  "/pricing": "2026-10-19",
  "/about": "2026-10-05",
  "/contact": "2026-10-05",
  "/faq": "2026-10-05",
  "/schools": "2026-10-31",
  "/schools/nursery-kindergarten": "2026-10-31",
  "/schools/primary-schools": "2026-10-31",
  "/schools/junior-schools": "2026-10-31",
  "/schools/secondary-schools": "2026-10-31",
  "/schools/integrated-schools": "2026-10-31",
  "/blog": "2026-10-05",
  "/privacy": "2026-10-05",
  "/terms": "2026-10-05",
};
