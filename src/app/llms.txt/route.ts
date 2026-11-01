import { SITE_URL, SITE_NAME } from "@/lib/site";
import { BLOG_POSTS } from "@/lib/blog-posts";

// /llms.txt -- a plain-text, Markdown-formatted map of the site for AI
// assistants and answer engines (llmstxt.org convention). It is a hint, not
// a ranking signal; the value is giving a model one clean place to learn
// what EduCore is and which pages answer which questions.
//
// Deliberately restricted to facts already published on the site (pricing
// from /pricing, the 30-day trial from /faq, module list from /platform).
// It lives outside the proxy: the proxy matcher already skips any path
// ending in .txt, so no NEVER_PREFIX entry is needed (same reason
// robots.txt works).
//
// Static: built once per deploy. Blog entries come from BLOG_POSTS so a new
// post can't be published and left out.
export const dynamic = "force-static";

const PAGES: { path: string; label: string; note: string }[] = [
  { path: "/platform", label: "Platform", note: "Every module and what it does" },
  { path: "/solutions", label: "Solutions", note: "How EduCore fits different kinds of schools" },
  { path: "/schools", label: "School types", note: "Landing pages for nursery, primary, junior, secondary and integrated schools" },
  { path: "/schools/nursery-kindergarten", label: "Nursery and kindergarten schools", note: "Admissions, learner records, M-Pesa fees, attendance and parent messaging" },
  { path: "/schools/primary-schools", label: "Primary schools", note: "CBC assessment, exams, report cards, attendance and fees" },
  { path: "/schools/junior-schools", label: "Junior schools", note: "CBE rubrics and assessment, exams, report cards, timetables and fees" },
  { path: "/schools/secondary-schools", label: "Secondary schools", note: "Exams and marks approval, report cards, fees, boarding, staff and timetables" },
  { path: "/schools/integrated-schools", label: "Integrated schools", note: "Several levels and campuses on one platform" },
  { path: "/student-management-system", label: "Student management system", note: "Student records, guardians, discipline, medical, certificates" },
  { path: "/cbc-school-management", label: "CBC school management", note: "Numeric and CBC competency-based grading" },
  { path: "/school-attendance-management", label: "School attendance management", note: "Attendance, corrections, guardian SMS alerts" },
  { path: "/parent-communication", label: "Parent communication", note: "Parent portal, newsletters, notifications" },
  { path: "/finance-fees", label: "Finance and fees", note: "Fee management and M-Pesa collection" },
  { path: "/student-performance-appraisal", label: "Student performance appraisal", note: "Tracking and appraising learner performance" },
  { path: "/teacher-performance-management", label: "Teacher performance management", note: "Teacher performance reviews" },
  { path: "/ai-automation", label: "AI automation", note: "AI features (Enterprise plan)" },
  { path: "/security", label: "Security", note: "Data isolation and security practices" },
  { path: "/pricing", label: "Pricing", note: "Flat KES 100 per student, per term, across all plans" },
  { path: "/faq", label: "FAQ", note: "Common questions on modules, trial, billing, data and offline use" },
  { path: "/about", label: "About", note: "About EduCore" },
  { path: "/contact", label: "Contact", note: "Book a demo or get in touch" },
];

export function GET() {
  const lines: string[] = [
    `# ${SITE_NAME}`,
    "",
    "> EduCore is a school management platform for Kenyan schools. It brings admissions, academics (numeric and CBC grading), finance with M-Pesa fee collection, attendance, and parent communication into one system.",
    "",
    "Key facts:",
    "- Built for schools in Kenya.",
    "- Pricing: a flat KES 100 per student, per term, across Starter, Growth and Enterprise; plans differ by modules and support, not price.",
    "- Every school gets a 30-day free trial, no card required.",
    `- Website: ${SITE_URL}`,
    "",
    "## Product pages",
    ...PAGES.map((p) => `- [${p.label}](${SITE_URL}${p.path}): ${p.note}`),
    "",
    "## Guides and articles",
    ...BLOG_POSTS.map(
      (post) => `- [${post.title.replace(/ — EduCore$/, "")}](${SITE_URL}/blog/${post.slug}): ${post.description}`,
    ),
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
