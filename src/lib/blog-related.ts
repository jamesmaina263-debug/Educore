// Hand-written "Keep reading" links between guides and from landing pages to
// the guides that back them up. Why this exists: before this map most guides
// had no contextual inbound links (only the blog index), so search engines
// had little signal about which pages relate or matter. Every pairing below
// is chosen by topic -- do not add a link just to raise a count.
//
// Rules enforced by blog-related.test.ts: every slug is a real post, no post
// links to itself, every post has 2-3 related guides, and every post is
// referenced by at least one other post (no orphans). When you publish a new
// post, add it here AND list it under at least one other post's related set.
export const RELATED_GUIDES: Record<string, string[]> = {
  "what-is-a-school-management-system-kenya": [
    "best-school-management-system-kenya",
    "free-school-management-system-kenya",
    "gititu-high-school-case-study",
  ],
  "best-school-management-system-kenya": [
    "what-is-a-school-management-system-kenya",
    "free-school-management-system-kenya",
    "mpesa-fee-collection-automation-kenya-schools",
  ],
  "free-school-management-system-kenya": [
    "best-school-management-system-kenya",
    "what-is-a-school-management-system-kenya",
    "data-protection-act-kenya-schools-guide",
  ],
  "gititu-high-school-case-study": [
    "mpesa-fee-collection-automation-kenya-schools",
    "student-performance-appraisal-kenya-schools",
    "best-school-management-system-kenya",
  ],
  "mpesa-fee-collection-automation-kenya-schools": [
    "mpesa-paybill-till-stk-push-school-fees",
    "gititu-high-school-case-study",
    "best-school-management-system-kenya",
  ],
  "mpesa-paybill-till-stk-push-school-fees": [
    "mpesa-fee-collection-automation-kenya-schools",
    "gititu-high-school-case-study",
    "best-school-management-system-kenya",
  ],
  "parent-communication-whatsapp-sms-kenya-schools": [
    "data-protection-act-kenya-schools-guide",
    "mpesa-fee-collection-automation-kenya-schools",
    "gititu-high-school-case-study",
  ],
  "data-protection-act-kenya-schools-guide": [
    "parent-communication-whatsapp-sms-kenya-schools",
    "boarding-school-management-kenya",
    "best-school-management-system-kenya",
  ],
  "boarding-school-management-kenya": [
    "data-protection-act-kenya-schools-guide",
    "parent-communication-whatsapp-sms-kenya-schools",
    "best-school-management-system-kenya",
  ],
  "school-payroll-statutory-deductions-kenya": [
    "teacher-performance-reviews-kenya-schools",
    "best-school-management-system-kenya",
    "what-is-a-school-management-system-kenya",
  ],
  "teacher-performance-reviews-kenya-schools": [
    "school-payroll-statutory-deductions-kenya",
    "student-performance-appraisal-kenya-schools",
    "best-school-management-system-kenya",
  ],
  "student-performance-appraisal-kenya-schools": [
    "cbc-cbe-assessment-learner-performance-kenya",
    "teacher-performance-reviews-kenya-schools",
    "kjsea-sba-records-kenya-schools",
  ],
  "cbc-cbe-assessment-learner-performance-kenya": [
    "kjsea-sba-records-kenya-schools",
    "cbc-scheme-of-work-kenya-how-to-write",
    "kicd-curriculum-design-strands-sub-strands-explained",
  ],
  "kjsea-sba-records-kenya-schools": [
    "cbc-cbe-assessment-learner-performance-kenya",
    "senior-school-pathways-kenya-stem-social-sciences-arts-sports",
    "kicd-curriculum-design-strands-sub-strands-explained",
  ],
  "cbc-scheme-of-work-kenya-how-to-write": [
    "kicd-curriculum-design-strands-sub-strands-explained",
    "cbc-cbe-assessment-learner-performance-kenya",
    "senior-school-pathways-kenya-stem-social-sciences-arts-sports",
  ],
  "kicd-curriculum-design-strands-sub-strands-explained": [
    "cbc-scheme-of-work-kenya-how-to-write",
    "cbc-cbe-assessment-learner-performance-kenya",
    "senior-school-pathways-kenya-stem-social-sciences-arts-sports",
  ],
  "senior-school-pathways-kenya-stem-social-sciences-arts-sports": [
    "kjsea-sba-records-kenya-schools",
    "kicd-curriculum-design-strands-sub-strands-explained",
    "cbc-cbe-assessment-learner-performance-kenya",
  ],
};

// Landing page path -> the guides that back it up. Only pages where a guide
// is a genuinely relevant next read are listed.
export const GUIDES_FOR_PAGE: Record<string, string[]> = {
  "/finance-fees": [
    "mpesa-fee-collection-automation-kenya-schools",
    "mpesa-paybill-till-stk-push-school-fees",
  ],
  "/parent-communication": [
    "parent-communication-whatsapp-sms-kenya-schools",
    "data-protection-act-kenya-schools-guide",
  ],
  "/student-management-system": [
    "what-is-a-school-management-system-kenya",
    "best-school-management-system-kenya",
    "gititu-high-school-case-study",
  ],
  "/cbc-school-management": [
    "cbc-cbe-assessment-learner-performance-kenya",
    "kjsea-sba-records-kenya-schools",
    "cbc-scheme-of-work-kenya-how-to-write",
  ],
  "/platform": [
    "what-is-a-school-management-system-kenya",
    "best-school-management-system-kenya",
    "school-payroll-statutory-deductions-kenya",
  ],
  "/pricing": [
    "free-school-management-system-kenya",
    "what-is-a-school-management-system-kenya",
    "gititu-high-school-case-study",
  ],
  "/security": ["data-protection-act-kenya-schools-guide"],
  "/solutions": [
    "boarding-school-management-kenya",
    "best-school-management-system-kenya",
  ],
  "/about": ["gititu-high-school-case-study"],
};
