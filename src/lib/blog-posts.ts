// Registry of published blog posts, used by the /blog index page.
//
// There's no CMS behind the blog -- each post is a hand-built page under
// src/app/(marketing)/blog/[slug]/page.tsx, same as every other marketing
// page. This file is just the shared list so the index page (and any
// future "related posts" or sitemap entry) has one place to read from
// instead of hardcoding post cards inline. When you add a new post page,
// add one entry here too.
export type BlogPostSummary = {
  slug: string;
  title: string;
  description: string;
  /** ISO date (YYYY-MM-DD) the post actually went live -- check git log
   *  on the post's page.tsx rather than guessing, so this stays accurate. */
  publishedOn: string;
};

export const BLOG_POSTS: BlogPostSummary[] = [
  {
    slug: "best-school-management-system-kenya",
    title: "Best School Management System in Kenya (2026 Guide)",
    description:
      "What actually separates a school management system schools keep using from one that gets abandoned for spreadsheets — M-Pesa, CBC grading, offline resilience, and real data isolation, evaluated for Kenyan schools.",
    publishedOn: "2026-08-30",
  },
  {
    slug: "cbc-cbe-assessment-learner-performance-kenya",
    title: "CBC, CBE and Learner Performance: A Practical Guide for Kenyan Schools",
    description:
      "How CBC/CBE competency-based assessment works in Kenya, the roles KICD and KNEC actually play, and how EduCore turns strand-level assessment records into real performance insight for schools.",
    publishedOn: "2026-09-03",
  },
];
