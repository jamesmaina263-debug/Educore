// Single source of truth for the marketing nav's information architecture.
// Desktop (nav.tsx) and mobile (mobile-nav.tsx) both read from this file so
// the two surfaces can't drift out of sync with each other.
//
// Structure: top-level items are either a plain link, or a dropdown made of
// one or more labeled groups of links. Adding a new module later means
// adding a link to the right group here -- it does not require touching
// nav.tsx or mobile-nav.tsx.

export type NavLink = { href: string; label: string };
export type NavGroup = { heading: string; links: NavLink[] };
export type NavDropdown = { label: string; groups: NavGroup[] };
export type NavItem = NavLink | NavDropdown;

export function isDropdown(item: NavItem): item is NavDropdown {
  return "groups" in item;
}

// Platform: the product surface area, grouped by job-to-be-done rather than
// listed as 20 flat feature links. Targets point at the real sections of
// /platform (or a module's own dedicated page, where one exists) -- nothing
// here links to a page that doesn't exist yet.
const PLATFORM: NavDropdown = {
  label: "Platform",
  groups: [
    {
      heading: "Core School Management",
      links: [
        { href: "/student-management-system", label: "Student Management" },
        { href: "/platform#admissions", label: "Admissions" },
        { href: "/platform#academics", label: "Academic Management" },
        { href: "/school-attendance-management", label: "Attendance" },
        { href: "/platform#academics", label: "Timetables" },
        { href: "/platform#academics", label: "Exams & Assessments" },
      ],
    },
    {
      heading: "Finance & Operations",
      links: [
        { href: "/finance-fees", label: "Fees & Payments" },
        { href: "/platform#finance", label: "Finance" },
        { href: "/platform#finance", label: "HR & Payroll" },
        { href: "/platform#finance", label: "Inventory" },
      ],
    },
    {
      heading: "Engagement & Intelligence",
      links: [
        { href: "/parent-communication", label: "Parent Portal" },
        { href: "/platform#communication", label: "Communication" },
        { href: "/platform#communication", label: "Reports & Analytics" },
        { href: "/ai-automation", label: "AI & Automation" },
      ],
    },
    {
      heading: "Integrations",
      links: [
        { href: "/platform#integrations", label: "Integrations" },
        { href: "/platform#integrations", label: "API" },
      ],
    },
  ],
};

// Solutions: who EduCore serves and what problem it solves, not a second
// copy of the Platform menu. "By Role" points at the real per-role sections
// already built on /solutions; "By Challenge" points at the dedicated page
// that actually answers that problem.
const SOLUTIONS: NavDropdown = {
  label: "Solutions",
  groups: [
    {
      heading: "By Role",
      links: [
        { href: "/solutions#school-owners", label: "School Owners" },
        { href: "/solutions#administrators", label: "Administrators" },
        { href: "/solutions#teachers", label: "Teachers" },
        { href: "/solutions#finance-teams", label: "Finance Teams" },
        { href: "/solutions#parents", label: "Parents" },
      ],
    },
    {
      heading: "By Challenge",
      links: [
        { href: "/platform", label: "Manage School Operations" },
        { href: "/finance-fees", label: "Simplify Fee Collection" },
        { href: "/parent-communication", label: "Improve Parent Engagement" },
        { href: "/ai-automation", label: "Automate Administration" },
      ],
    },
  ],
};

export const NAV_ITEMS: NavItem[] = [
  PLATFORM,
  SOLUTIONS,
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];
