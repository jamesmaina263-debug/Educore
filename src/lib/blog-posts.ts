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
    slug: "teacher-performance-reviews-kenya-schools",
    title: "Teacher Performance Reviews for Kenyan Schools: Termly, Structured, and Kept Private",
    description:
      "Why teacher appraisal usually lives in a locked cabinet or a Principal's private notebook, and how EduCore keeps it structured instead — 1-5 competency scoring, an automatically computed rating, and visibility locked to the reviewer tier and the teacher being reviewed.",
    publishedOn: "2026-09-21",
  },
  {
    slug: "school-payroll-statutory-deductions-kenya",
    title: "School Payroll in Kenya: PAYE, SHIF, NSSF and the Housing Levy Explained (2026)",
    description:
      "The four statutory deductions on a Kenyan school payslip in 2026: what each is, the rates after the February 2026 NSSF change, the order they are applied in, a worked example, deadlines, and common mistakes.",
    publishedOn: "2026-09-21",
  },
  {
    slug: "boarding-school-management-kenya",
    title: "Boarding School Management in Kenya: Safety Standards, Roll Call and the Records That Matter",
    description:
      "What the Ministry's Safety Standards Manual expects of a boarding school, the records that back those standards up, how to handle exeats and visitors, and what software can and cannot do.",
    publishedOn: "2026-09-21",
  },
  {
    slug: "mpesa-paybill-till-stk-push-school-fees",
    title: "M-Pesa Paybill vs Till vs STK Push for School Fees in Kenya",
    description:
      "Paybill and Till are where school fees land. STK push is how a payment gets started. What each does, who pays the fee, how it affects reconciliation, and how a school should set them up.",
    publishedOn: "2026-09-21",
  },
  {
    slug: "gititu-high-school-case-study",
    title: "Case Study: Gititu High School on Running End of Term From One System",
    description:
      "In his own words, the principal of Gititu High School describes end of term before and after moving marks, fees and student records into EduCore, what surprised the school, and what still needs improving.",
    publishedOn: "2026-09-20",
  },
  {
    slug: "data-protection-act-kenya-schools-guide",
    title: "The Data Protection Act for Kenyan Schools: A Practical Guide",
    description:
      "What Kenya's Data Protection Act asks of schools: registering with the ODPC, parental consent, photos and exam results, children's and biometric data, the 72-hour breach rule, and what to ask your software vendor, including where your data is stored.",
    publishedOn: "2026-09-20",
  },
  {
    slug: "kjsea-sba-records-kenya-schools",
    title: "KJSEA and School-Based Assessment: The Grade 7\u20138 Records Your School Needs on File",
    description:
      "Grade 7 and 8 school-based assessment makes up a fifth of a learner's KJSEA score. What the SBA actually is, who uploads it, what KNEC asks schools to keep, and where records go missing.",
    publishedOn: "2026-09-20",
  },
  {
    slug: "free-school-management-system-kenya",
    title: "Free School Management Software in Kenya: What \"Free\" Actually Covers",
    description:
      "Free core platforms, open-source editions, student-capped free tiers and trials all get called free. Where the real costs show up for a Kenyan school, a checklist to compare them, and when free is genuinely the right call.",
    publishedOn: "2026-09-20",
  },
  {
    slug: "student-performance-appraisal-kenya-schools",
    title: "Student Performance Appraisal & Merit Lists for Kenyan Schools",
    description:
      "Why end-of-term merit lists usually mean a teacher rebuilding a spreadsheet from scratch, and how EduCore computes rankings, growth trends, and a class performance dashboard automatically from the marks already entered.",
    publishedOn: "2026-09-14",
  },
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
  {
    slug: "parent-communication-whatsapp-sms-kenya-schools",
    title: "Parent Communication for Kenyan Schools: Beyond the WhatsApp Group",
    description:
      "Why the class WhatsApp group breaks down as a school grows, and how EduCore handles parent communication instead — structured teacher-to-parent items, a two-way WhatsApp assistant, targeted announcements, and fee alerts a human always approves first.",
    publishedOn: "2026-09-03",
  },
  {
    slug: "mpesa-fee-collection-automation-kenya-schools",
    title: "M-Pesa Fee Collection Automation for Kenyan Schools",
    description:
      "Why manual M-Pesa reconciliation is where Kenyan school bursars lose the most time, and how EduCore automates it — STK push, statement matching, and auto-allocation to invoices.",
    publishedOn: "2026-09-04",
  },
];
