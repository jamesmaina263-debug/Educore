import {
  BellRing,
  BookOpen,
  Building2,
  CalendarClock,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Landmark,
  LayoutGrid,
  Layers,
  MessageCircle,
  ScrollText,
  Users,
  UserCheck,
  UserPlus,
  Wallet,
  BedDouble,
  Briefcase,
  type LucideIcon,
} from "lucide-react";

// Content for the /schools/[category] landing pages (rendered by
// src/components/marketing/school-category-page.tsx).
//
// Every capability named here was checked against the codebase, not assumed. The
// authoritative sources are the same ones the rest of the marketing site already
// relies on: the module list on /platform, the verified claims (with evidence
// paths) in src/lib/growth/product-facts.ts, and the existing /faq answers.
// Deliberate omissions, following product-facts.ts's own rules:
//  - no claim of KNEC / KICD / Ministry approval, endorsement or integration;
//  - no customer names, testimonials, statistics or implementation timelines;
//  - nothing about "result locking" (marks go submitted -> approved, but a lock
//    on approved marks was not verified);
//  - the nursery/kindergarten copy never mentions exams, marks, grades or
//    rankings, and does not claim reports are designed for pre-primary children.
// Pricing and trial wording are NOT written here: the page component pulls them
// from src/lib/marketing/trial.ts and product-facts.ts so they can't drift.
//
// The schools table has no nursery/primary/secondary category column (its
// `school_type` means boys/girls/mixed), so these pages are marketing-only and
// need no schema change. Which category a visitor came from is carried by the
// existing delegated CTA tracker (analytics.tsx), which already records the page
// path as cta_location on every /contact and /signup click.

import type { SchoolCategorySlug } from "@/lib/marketing/school-category-options";
export type { SchoolCategorySlug };

export type CategoryChallenge = { title: string; problem: string; help: string };
export type CategoryModule = {
  icon: LucideIcon;
  title: string;
  audience: string;
  description: string;
  capabilities: string[];
};
export type CategoryBenefit = { audience: string; icon: LucideIcon; text: string };
export type CategoryStep = { title: string; description: string };
export type CategoryFaq = { q: string; a: string };

/** Which illustrative product preview sits beside the "how EduCore helps" section. */
export type CategoryPreview = "fees" | "attendance" | "assessment" | "marks" | "campuses";

export type SchoolCategory = {
  slug: SchoolCategorySlug;
  /** Short name used in nav, breadcrumbs and cross-links. */
  navLabel: string;
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  h1: string;
  heroLead: string;
  /** One sentence for the /schools hub card. */
  summary: string;
  coreMessage: string;
  /** "Built for ..." chips under the hero copy. */
  audience: string[];
  challenges: CategoryChallenge[];
  preview: CategoryPreview;
  modules: CategoryModule[];
  benefits: CategoryBenefit[];
  steps: CategoryStep[];
  faqs: CategoryFaq[];
  related: SchoolCategorySlug[];
  /** Image alt text for the hero dashboard preview. */
  heroAlt: string;
};

// Reused verbatim from /faq (src/app/(marketing)/faq/page.tsx) so the wording
// stays identical across the site.
const FAQ_TRIAL: CategoryFaq = {
  q: "Is there a free trial?",
  a: "Yes. Every school gets a 30-day free trial, no card required. You can create your school's account yourself and start using EduCore straight away, or book a demo first if you'd rather have a walkthrough.",
};
const FAQ_MPESA: CategoryFaq = {
  q: "Does EduCore support M-Pesa for fee payments?",
  a: "Yes, M-Pesa is built into the finance module, so fee payments reconcile automatically instead of being matched by hand against a paper ledger. Each school connects its own M-Pesa details.",
};
const FAQ_ISOLATION: CategoryFaq = {
  q: "Is our school's data isolated from other schools on EduCore?",
  a: "Yes. Every school's data is architecturally separated at the database level — one school's records are never visible to another, enforced by row-level security rather than application-level checks alone.",
};
const FAQ_GRADING: CategoryFaq = {
  q: "Does EduCore support both numeric and competency-based (CBC) grading?",
  a: "Yes, both grading models are supported from the ground up, and can be set per school, grade, or class rather than forcing every school onto one system.",
};

export const SCHOOL_CATEGORIES: readonly SchoolCategory[] = [
  // ---------------------------------------------------------------- nursery
  {
    slug: "nursery-kindergarten",
    navLabel: "Nursery & Kindergarten",
    metaTitle: "Nursery & Kindergarten School Software in Kenya | EduCore",
    metaDescription:
      "Nursery and kindergarten school management software for Kenya: admissions, learner records, M-Pesa fees, attendance and parent updates. 30-day free trial.",
    eyebrow: "Nursery & Kindergarten",
    h1: "Nursery and kindergarten school management software, built for Kenyan schools.",
    heroLead:
      "Spend less time managing paperwork and more time nurturing young learners. Admissions, learner records, fees, attendance and parent updates stay in one place instead of across registers, receipt books and WhatsApp groups.",
    summary:
      "Admissions, learner records, M-Pesa fees, attendance and parent updates for PP1, PP2 and early-years schools.",
    coreMessage: "Spend less time managing paperwork and more time nurturing young learners.",
    audience: ["Nursery school owners", "Kindergarten directors", "Early childhood administrators", "PP1 and PP2 administrators"],
    challenges: [
      {
        title: "Enrolment paperwork piles up",
        problem:
          "Every new family brings a registration form, birth documents and a stack of contact details that end up in different files.",
        help: "Applications are tracked per applicant, and once enrolled each learner has one record with their documents stored alongside it.",
      },
      {
        title: "Fees are chased by hand",
        problem:
          "Parents pay by M-Pesa, cash and bank, and someone has to match every payment to the right child and issue a receipt.",
        help: "M-Pesa payments reconcile automatically, balances sit on each learner's account, and receipts come from the same finance records.",
      },
      {
        title: "Parents want to know their child arrived safely",
        problem:
          "Small children, anxious parents and a busy front desk make 'did they get there?' calls a daily interruption.",
        help: "Attendance is marked per class register, and parents can be notified automatically instead of phoning the office.",
      },
      {
        title: "Updates reach parents unevenly",
        problem: "Notices, reminders and progress news go out through whichever chat or paper note someone remembers to send.",
        help: "Messages go to parents by SMS and WhatsApp from templates, with a history of what was sent.",
      },
    ],
    preview: "fees",
    modules: [
      {
        icon: UserPlus,
        title: "Admissions & learner records",
        audience: "Directors & Administrators",
        description:
          "Track each family's application, then keep one record per learner with their documents stored alongside it.",
        capabilities: [
          "Per-applicant status tracking",
          "Central learner directory",
          "Learner documents stored with the record",
          "PP1 and PP2 classes with the pre-primary activity areas",
        ],
      },
      {
        icon: Wallet,
        title: "Fees, M-Pesa & receipts",
        audience: "Directors & Finance",
        description:
          "Fee structures per term, class or learner, with M-Pesa payments reconciled for you and receipts printed from the same records.",
        capabilities: [
          "Fee structures and invoicing",
          "Per-learner account balances",
          "M-Pesa payment reconciliation",
          "Printable receipts and payment records",
        ],
      },
      {
        icon: UserCheck,
        title: "Attendance",
        audience: "Teachers & Administrators",
        description: "A simple class register for every day, with parents notified automatically.",
        capabilities: ["Stream-based attendance register", "Automatic parent notification"],
      },
      {
        icon: MessageCircle,
        title: "Parent communication",
        audience: "Directors & Teachers",
        description: "One dependable way to reach every family, plus a portal where parents see their child's information.",
        capabilities: ["SMS and WhatsApp messaging", "Message templates and sent history", "Parent portal linked to their children"],
      },
      {
        icon: ScrollText,
        title: "Learner progress reports",
        audience: "Teachers & Directors",
        description:
          "Competency-based progress reports with CBC competency ratings by sub-strand, built from what teachers already record.",
        capabilities: ["Competency-based learner progress reports", "Management reports exportable to Excel and PDF"],
      },
    ],
    benefits: [
      {
        audience: "School owners",
        icon: Landmark,
        text: "See who has paid and who hasn't without waiting for the end-of-term ledger, and keep your records in one account instead of one person's files.",
      },
      {
        audience: "Directors & administrators",
        icon: Briefcase,
        text: "Replace registration piles, receipt books and register tallies with records that are already in the right place.",
      },
      {
        audience: "Teachers",
        icon: Users,
        text: "Take the class register once and move on; the parent notification and the records follow from it.",
      },
      {
        audience: "Parents",
        icon: BellRing,
        text: "Hear from the school through SMS or WhatsApp, and pay fees by M-Pesa without queueing at the office.",
      },
    ],
    steps: [
      {
        title: "Create your school's account",
        description: "Sign up yourself. No card is required to start the 30-day free trial.",
      },
      {
        title: "Set up your classes",
        description: "Add your PP1 and PP2 classes, your terms and your fee structure.",
      },
      {
        title: "Add learners and staff",
        description: "Enrol learners, link their parents and add the staff who will take registers.",
      },
      {
        title: "Use the modules you need",
        description: "Start with fees and attendance, add parent messaging, and expand when you're ready.",
      },
    ],
    faqs: [
      {
        q: "Does EduCore support PP1 and PP2 classes?",
        a: "Yes. Classes can be set up at PP1 and PP2 level, and the platform includes the pre-primary activity areas, so your classes don't have to be squeezed into a primary-school structure.",
      },
      FAQ_MPESA,
      {
        q: "Can we keep learner documents with each record?",
        a: "Yes. Documents can be stored against each learner's record in EduCore instead of in a separate folder or filing cabinet.",
      },
      {
        q: "How do we keep parents informed?",
        a: "EduCore supports parent messaging by SMS and WhatsApp, and attendance can notify parents automatically. Which modules you get depends on your plan, so ask us when you book a demo.",
      },
      {
        q: "Can EduCore produce progress reports for young learners?",
        a: "EduCore produces competency-based learner progress reports, with CBC competency ratings by sub-strand. Book a demo and we'll show you the report format, so you can judge how it fits the way your school reports to parents.",
      },
      FAQ_TRIAL,
    ],
    related: ["primary-schools", "integrated-schools", "junior-schools"],
    heroAlt: "EduCore dashboard preview showing fees, attendance and learner records for a school",
  },

  // ---------------------------------------------------------------- primary
  {
    slug: "primary-schools",
    navLabel: "Primary Schools",
    metaTitle: "Primary School Management System in Kenya | EduCore",
    metaDescription:
      "Primary school management system for Kenya: CBC assessment, exams, report cards, attendance, M-Pesa fees and timetables in one place. Try free for 30 days.",
    eyebrow: "Primary Schools",
    h1: "The primary school management system built for CBC and for how Kenyan schools get paid.",
    heroLead:
      "Bring your school's academic and administrative operations together in one organised system: learner records, CBC assessment, exams, report cards, attendance, fees and parent communication.",
    summary:
      "CBC assessment, exams, report cards, attendance, timetables and fee collection for primary schools.",
    coreMessage: "Bring your school's academic and administrative operations together in one organised system.",
    audience: ["Private primary school owners", "Headteachers", "School directors", "Primary school administrators"],
    challenges: [
      {
        title: "Assessment and marks live in different places",
        problem:
          "CATs, exam marks and CBC competency ratings sit in exercise books and spreadsheets that someone has to combine at the end of term.",
        help: "Marks are entered against numeric or CBC competency scales set for your school, grade or class, and report cards are built from them.",
      },
      {
        title: "Report cards take too long",
        problem: "Compiling, checking and printing a class's reports can swallow days that teachers need for teaching.",
        help: "Class report cards are generated from the marks already recorded, with a teacher approval step before parents can see them and a print view for paper copies.",
      },
      {
        title: "Fee records and M-Pesa don't agree",
        problem: "Balances drift when payments are matched to learners by hand, and parents dispute figures nobody can quickly verify.",
        help: "M-Pesa payments reconcile automatically and each learner's balance reflects money that has actually arrived.",
      },
      {
        title: "Timetables, staff and streams are rebuilt every term",
        problem: "Classes, streams, subjects and teacher allocation are re-created in a new document each term.",
        help: "Classes, streams, subjects, the academic calendar and teacher allocation sit in one structure, with automated term rollover.",
      },
    ],
    preview: "assessment",
    modules: [
      {
        icon: GraduationCap,
        title: "Learner records & admissions",
        audience: "Headteachers & Administrators",
        description: "Applications, enrolment and one record per learner that links academic, health and finance information.",
        capabilities: ["Per-applicant status tracking", "Central learner directory", "Linked academic, health and finance records", "Documents stored with each learner"],
      },
      {
        icon: ClipboardCheck,
        title: "CBC assessment & exams",
        audience: "Teachers & Academic Heads",
        description: "CATs, exams and marks entry graded against numeric or CBC competency scales, set per school, grade or class.",
        capabilities: ["CAT and exam scheduling", "Marks entry on numeric or CBC scales", "Structured CBC rubrics scored per learner", "Merit lists and a class performance dashboard"],
      },
      {
        icon: FileText,
        title: "Report cards",
        audience: "Teachers & Headteachers",
        description: "Report cards and competency-based progress reports generated from the marks teachers have recorded.",
        capabilities: ["Class report cards generated from recorded marks", "Teacher approval before release to the parent portal", "Print view for paper copies", "CBC competency ratings by sub-strand"],
      },
      {
        icon: Wallet,
        title: "Fees & M-Pesa reconciliation",
        audience: "Finance Teams",
        description: "Fee structures, invoices and per-learner balances reconciled against M-Pesa.",
        capabilities: ["Fee structures per term, class or learner", "M-Pesa payment reconciliation", "Printable receipts"],
      },
      {
        icon: CalendarClock,
        title: "Attendance & timetable",
        audience: "Teachers & Administrators",
        description: "Daily registers per stream, plus timetable and teacher allocation next to your classes and subjects.",
        capabilities: ["Stream-based attendance register", "Automatic parent notification", "Timetable and teacher allocation"],
      },
      {
        icon: MessageCircle,
        title: "Parents & staff",
        audience: "Directors & Administrators",
        description: "Reach parents by SMS and WhatsApp, and manage staff records and permissions centrally.",
        capabilities: ["SMS and WhatsApp messaging", "Parent portal for fees, attendance and grades", "Staff directory with roles and permissions"],
      },
    ],
    benefits: [
      {
        audience: "School owners",
        icon: Landmark,
        text: "One view of academics and fees across the school, and records that don't leave when a clerk or teacher does.",
      },
      {
        audience: "Headteachers & administrators",
        icon: Briefcase,
        text: "Less end-of-term compiling: classes, marks, reports and fee balances are drawn from the same records.",
      },
      {
        audience: "Teachers",
        icon: Users,
        text: "Enter marks and competency ratings once, in the scale your school uses, and let the report cards follow.",
      },
      {
        audience: "Parents",
        icon: BellRing,
        text: "A portal for fees, attendance and grades, and school messages by SMS or WhatsApp.",
      },
    ],
    steps: [
      { title: "Create your school's account", description: "Sign up yourself. No card is required to start the 30-day free trial." },
      { title: "Set up classes, streams and subjects", description: "Add your academic years and terms, classes and streams, subjects and teacher allocation." },
      { title: "Choose your grading scale", description: "Set numeric or CBC competency grading for your school, grade or class." },
      { title: "Add learners and go live by module", description: "Enrol learners and staff, then switch on attendance, fees, exams and parent messaging as you need them." },
    ],
    faqs: [
      FAQ_GRADING,
      {
        q: "Can we produce report cards from EduCore?",
        a: "Yes. Report cards are built from the marks and competency ratings teachers enter, using the grading scale set for your school, grade or class.",
      },
      FAQ_MPESA,
      {
        q: "Does EduCore handle timetables and streams?",
        a: "Yes. Classes, streams, subjects, the academic calendar, timetable and teacher allocation are set up in one place, and terms can roll over automatically.",
      },
      {
        q: "Can parents see fees, attendance and grades?",
        a: "Yes. Parents have a portal login linked to their children, where fees, attendance and grades are visible. Which modules are included depends on your plan.",
      },
      FAQ_TRIAL,
    ],
    related: ["junior-schools", "nursery-kindergarten", "integrated-schools"],
    heroAlt: "EduCore dashboard preview showing academics, fees and attendance for a primary school",
  },

  // ----------------------------------------------------------------- junior
  {
    slug: "junior-schools",
    navLabel: "Junior Schools",
    metaTitle: "Junior School Management System (CBE) in Kenya | EduCore",
    metaDescription:
      "Junior school management system for Kenya: CBE assessment rubrics, exams, report cards, timetables and M-Pesa fees in one platform. 30-day free trial.",
    eyebrow: "Junior Schools",
    h1: "A junior school management system for CBE assessment and everyday school administration.",
    heroLead:
      "Make learner assessment, academic reporting and school administration easier with EduCore: CBE rubrics, exams, report cards, attendance, timetables and fee collection, working from the same learner records.",
    summary:
      "CBE rubrics, exams, report cards and day-to-day administration for junior school sections.",
    coreMessage: "Make learner assessment, academic reporting and school administration easier with EduCore.",
    audience: ["Junior school administrators", "School directors", "CBE-focused institutions", "Academic heads"],
    challenges: [
      {
        title: "Rubrics and competency evidence are hard to keep organised",
        problem: "Teachers score competencies on paper or in separate files, and pulling a learner's picture together is slow.",
        help: "Structured CBC rubrics are scored per learner, and competency ratings by sub-strand feed the learner's report.",
      },
      {
        title: "Two assessment styles in one school",
        problem: "Some work is marked numerically and some against competencies, and most tools force one or the other.",
        help: "Numeric and CBC competency scales are both supported and can be set per school, grade or class.",
      },
      {
        title: "Reporting takes more effort than it should",
        problem: "Turning assessment records into reports that parents and academic heads can use is manual work every term.",
        help: "Report cards and progress reports are built from recorded marks and competency ratings, approved by a teacher before release, with merit lists and a class performance dashboard.",
      },
      {
        title: "Administration competes with academics",
        problem: "Timetables, attendance, fee balances and parent updates all need attention at the same time as assessment.",
        help: "Timetable, attendance, fees with M-Pesa reconciliation and parent messaging live alongside assessment, in one platform.",
      },
    ],
    preview: "assessment",
    modules: [
      {
        icon: ClipboardCheck,
        title: "CBE assessment & rubrics",
        audience: "Teachers & Academic Heads",
        description: "Structured rubrics and competency scales for the way your school assesses, alongside numeric marks where you use them.",
        capabilities: ["Structured CBC rubrics scored per learner", "Marks entry on numeric or CBC competency scales", "Grading scale set per school, grade or class"],
      },
      {
        icon: BookOpen,
        title: "Exams",
        audience: "Teachers & Academic Heads",
        description: "Schedule CATs and exams, enter marks and see results at class level.",
        capabilities: ["CAT and exam scheduling", "Marks submitted by teachers and approved by authorised staff", "Merit lists and growth trends"],
      },
      {
        icon: FileText,
        title: "Report cards & academic reporting",
        audience: "Academic Heads & Directors",
        description: "Report cards and competency-based progress reports from the same assessment records.",
        capabilities: ["Class report cards generated from recorded marks", "Teacher approval before release to the parent portal", "Competency ratings by sub-strand", "Class performance dashboard"],
      },
      {
        icon: GraduationCap,
        title: "Learner records & admissions",
        audience: "Administrators",
        description: "Applications and one record per learner, with classes mapped to Grade 7, 8 and 9 or any other KICD grade level.",
        capabilities: ["Per-applicant status tracking", "Central learner directory", "Classes mapped to KICD grade levels, PP1 to Grade 12"],
      },
      {
        icon: CalendarClock,
        title: "Attendance & timetable",
        audience: "Teachers & Administrators",
        description: "Stream-based registers and a timetable with teacher allocation.",
        capabilities: ["Stream-based attendance register", "Automatic parent notification", "Timetable and teacher allocation"],
      },
      {
        icon: Wallet,
        title: "Fees & parent communication",
        audience: "Finance & Administrators",
        description: "Fee structures and M-Pesa reconciliation, with SMS and WhatsApp for parents.",
        capabilities: ["M-Pesa payment reconciliation", "Per-learner balances", "SMS and WhatsApp messaging"],
      },
    ],
    benefits: [
      {
        audience: "School owners & directors",
        icon: Landmark,
        text: "A clearer view of academic performance and fee position without asking three people for three spreadsheets.",
      },
      {
        audience: "Academic heads & administrators",
        icon: Briefcase,
        text: "Consistent assessment records across classes, and reports that come from them instead of being rebuilt each term.",
      },
      {
        audience: "Teachers",
        icon: Users,
        text: "Score rubrics and enter marks in the scale your school uses, in one place, and submit them for approval.",
      },
      {
        audience: "Parents",
        icon: BellRing,
        text: "Visibility of fees, attendance and grades in the parent portal, and school news by SMS or WhatsApp.",
      },
    ],
    steps: [
      { title: "Create your school's account", description: "Sign up yourself. No card is required to start the 30-day free trial." },
      { title: "Set up classes and subjects", description: "Add Grade 7 to 9 classes and streams, map them to their KICD grade levels, and add subjects and terms." },
      { title: "Choose how you assess", description: "Set numeric or CBC competency grading for your school, grade or class." },
      { title: "Add learners and begin recording", description: "Enrol learners and staff, then start with assessment and attendance and add fees and messaging when ready." },
    ],
    faqs: [
      {
        q: "Does EduCore support CBE assessment with rubrics?",
        a: "Yes. Marks can be entered against numeric or CBC competency scales, structured CBC rubrics can be scored per learner, and learner reports can show CBC competency ratings by sub-strand.",
      },
      {
        q: "Does EduCore submit results to KNEC automatically?",
        a: "EduCore doesn't advertise automatic submission to KNEC, and we don't claim any KNEC endorsement or affiliation. It keeps your assessment records organised and can generate NEMIS and KEMIS bulk-upload files. Tell us what you need to submit and we'll show you exactly what is available today.",
      },
      {
        q: "Can we set up Grade 7, 8 and 9 classes?",
        a: "Yes. Classes can be mapped to KICD grade levels, from PP1 through Grade 12, as a setting your school confirms rather than something guessed from the class name.",
      },
      FAQ_GRADING,
      FAQ_MPESA,
      FAQ_TRIAL,
    ],
    related: ["primary-schools", "secondary-schools", "integrated-schools"],
    heroAlt: "EduCore dashboard preview showing assessment, fees and attendance for a junior school",
  },

  // -------------------------------------------------------------- secondary
  {
    slug: "secondary-schools",
    navLabel: "Secondary Schools",
    metaTitle: "Secondary School Management Software in Kenya | EduCore",
    metaDescription:
      "Secondary school management software for Kenya: exams and CATs, report cards, M-Pesa fee reconciliation, boarding, timetables and staff in one system.",
    eyebrow: "Secondary Schools",
    h1: "Secondary school management software for exams, fees, boarding and everything around them.",
    heroLead:
      "Manage academics, finances and school operations with greater visibility and control: CATs and exams, report cards, M-Pesa fee reconciliation, timetables, boarding, staff and parent communication.",
    summary:
      "Exams and marks approval, report cards, M-Pesa fee reconciliation, boarding, staff and timetables.",
    coreMessage: "Manage academics, finances and school operations with greater visibility and control.",
    audience: ["Private secondary school owners", "Principals and deputy principals", "Bursars", "Academic administrators"],
    challenges: [
      {
        title: "Exam results are slow and hard to trust",
        problem: "Marks arrive late, in different formats, and nobody is sure which version is final before report cards are printed.",
        help: "Teachers enter and submit marks; authorised staff approve them, and merit lists and class dashboards are built from the approved data.",
      },
      {
        title: "The bursar's ledger and M-Pesa don't match",
        problem: "Large fee volumes, part-payments and several payment channels make reconciliation a standing job.",
        help: "M-Pesa payments reconcile automatically and only post once Safaricom's own callback confirms them. Cash, bank and cheque payments are recorded by officers.",
      },
      {
        title: "Boarding adds a second school to run",
        problem: "Dormitories, beds, roll calls and incidents are tracked separately from the student records they belong to.",
        help: "Dormitory, room and bed allocation, roll call, incidents and transfers sit in the same platform as the learner records.",
      },
      {
        title: "Staff, timetable and payroll sprawl",
        problem: "Teacher allocation, timetables, roles and payroll live in different files with different owners.",
        help: "Staff records and permissions, timetable and teacher allocation, and payroll with Kenyan statutory deductions are connected.",
      },
    ],
    preview: "marks",
    modules: [
      {
        icon: ClipboardCheck,
        title: "Exams, CATs & marks approval",
        audience: "Academic Heads & Teachers",
        description: "Schedule CATs and exams, enter marks, and have authorised staff approve them before results are used.",
        capabilities: ["CAT and exam scheduling", "Marks submitted by teachers, approved by authorised staff", "Merit lists, growth trends and a class performance dashboard", "Numeric or CBC grading scales"],
      },
      {
        icon: FileText,
        title: "Report cards",
        audience: "Principals & Academic Heads",
        description: "Class report cards built from recorded marks, with exports for printing and sharing.",
        capabilities: ["Class report cards generated from recorded marks", "Teacher approval before release to the parent portal", "Print view for paper copies", "Management reporting with Excel and PDF export"],
      },
      {
        icon: Wallet,
        title: "Fees & M-Pesa reconciliation",
        audience: "Bursars & Finance",
        description: "Fee structures, invoicing and per-student balances, reconciled against M-Pesa.",
        capabilities: ["Fee structures per term, class or student", "M-Pesa payment reconciliation", "Printable receipts and payment records"],
      },
      {
        icon: GraduationCap,
        title: "Student records & admissions",
        audience: "Principals & Administrators",
        description: "Applicants through to enrolled students, with one record linking academic, health and finance information.",
        capabilities: ["Per-applicant status tracking", "Central student directory", "Student documents stored with each record", "Classes, streams and subjects setup"],
      },
      {
        icon: BedDouble,
        title: "Boarding",
        audience: "Boarding Staff",
        description: "Run dormitories and boarders alongside the rest of the school. Boarding is part of the Growth plan and above.",
        capabilities: ["Dormitory, room and bed allocation", "Roll call", "Boarding incidents and transfers", "Boarding-specific reports"],
      },
      {
        icon: Briefcase,
        title: "Staff, timetable & communication",
        audience: "Deputy Principals & Administrators",
        description: "Staff directory and permissions, timetable and teacher allocation, and messaging to parents.",
        capabilities: ["Staff directory, roles and permissions", "Timetable and teacher allocation", "SMS and WhatsApp messaging", "Payroll with Kenyan statutory deductions (Growth plan and above)"],
      },
    ],
    benefits: [
      {
        audience: "School owners & principals",
        icon: Landmark,
        text: "One place to see academic results, fee position and operations, with an audit log behind them.",
      },
      {
        audience: "Deputy principals & bursars",
        icon: Briefcase,
        text: "Fewer reconciliations by hand, and marks that are approved before they reach a report card.",
      },
      {
        audience: "Teachers",
        icon: Users,
        text: "Enter and submit marks in one workflow, and see class performance without compiling it.",
      },
      {
        audience: "Parents & students",
        icon: BellRing,
        text: "Parents see fees, attendance and grades in the portal and hear from the school by SMS or WhatsApp.",
      },
    ],
    steps: [
      { title: "Create your school's account", description: "Sign up yourself. No card is required to start the 30-day free trial." },
      { title: "Set up classes, streams and subjects", description: "Add your academic years and terms, classes and streams, subjects and teacher allocation." },
      { title: "Add students, staff and fee structures", description: "Enrol students, add staff with their permissions and set up your fee structures." },
      { title: "Switch on the modules you need", description: "Begin with exams and fees, then add boarding, payroll and communication as your plan allows." },
    ],
    faqs: [
      {
        q: "Can teachers submit marks for approval?",
        a: "Yes. Teachers enter marks and submit them, and users with the marks-approval permission approve them. Report cards and merit lists are built from the recorded marks.",
      },
      {
        q: "Does EduCore support boarding schools?",
        a: "Yes. The boarding module covers dormitory, room and bed allocation, roll call, boarding incidents and transfers, and boarding-specific reports. Boarding is part of the Growth plan and above.",
      },
      {
        q: "How does EduCore keep M-Pesa fee records trustworthy?",
        a: "Only cash, bank and cheque payments are ever recorded on an officer's say-so. Real M-Pesa money only posts to a student's account once Safaricom's own callback confirms it, so a balance on screen reflects money that has actually arrived.",
      },
      {
        q: "Does EduCore handle payroll and staff?",
        a: "Yes. The staff directory with roles and permissions is part of the core platform, and payroll with Kenyan statutory deductions (NSSF, SHIF, Housing Levy and PAYE) is available on the Growth plan and above.",
      },
      FAQ_ISOLATION,
      FAQ_TRIAL,
    ],
    related: ["junior-schools", "integrated-schools", "primary-schools"],
    heroAlt: "EduCore dashboard preview showing exams, fees and boarding for a secondary school",
  },

  // ------------------------------------------------------------- integrated
  {
    slug: "integrated-schools",
    navLabel: "Integrated Schools",
    metaTitle: "Integrated School Management Software in Kenya | EduCore",
    metaDescription:
      "School management software for integrated schools and school groups in Kenya: PP1 to senior levels, fees, exams, attendance and campuses on one platform.",
    eyebrow: "Integrated Schools",
    h1: "One connected platform for schools that teach across several levels.",
    heroLead:
      "One connected platform for managing your school's operations across different educational levels, from pre-primary through primary and junior school, whether you run one campus or several.",
    summary:
      "One platform for schools that teach several levels or run several campuses, from pre-primary upward.",
    coreMessage: "One connected platform for managing your school's operations across different educational levels.",
    audience: ["Schools with several levels", "Nursery, primary and junior sections", "School groups", "Multi-campus owners"],
    challenges: [
      {
        title: "Each section keeps its own records",
        problem: "The nursery, primary and junior sections run on separate files and different habits, so no one sees the whole school.",
        help: "One learner directory covers every class, with classes mapped to levels from PP1 through Grade 12.",
      },
      {
        title: "One grading style doesn't fit every level",
        problem: "Younger classes and upper classes are assessed differently, and a single tool forces one approach on everyone.",
        help: "Numeric and CBC competency grading can be set per school, grade or class, so each level uses what suits it.",
      },
      {
        title: "Finance is split by section",
        problem: "Families with children in two sections receive two sets of fee records, and the owner reconciles them.",
        help: "Fee structures, invoices and M-Pesa reconciliation run in one finance module, with per-learner balances.",
      },
      {
        title: "Groups can't see across campuses",
        problem: "Schools under one owner end up with disconnected systems and no consolidated view.",
        help: "The campuses module gives school groups a cross-campus overview with group branding, from one account.",
      },
    ],
    preview: "campuses",
    modules: [
      {
        icon: Layers,
        title: "Learner records across levels",
        audience: "Owners & Administrators",
        description: "One learner directory for every section, with classes mapped to KICD grade levels from PP1 to Grade 12.",
        capabilities: ["Central learner directory", "Classes, streams and subjects setup", "Learner documents stored with each record", "Per-applicant admissions tracking"],
      },
      {
        icon: Wallet,
        title: "Finance across sections",
        audience: "Finance Teams & Owners",
        description: "Fee structures per term, class or learner, with M-Pesa payments reconciled in the same place.",
        capabilities: ["Fee structures and invoicing", "Per-learner account balances", "M-Pesa payment reconciliation", "Printable receipts"],
      },
      {
        icon: ClipboardCheck,
        title: "Exams & academic reporting",
        audience: "Academic Heads",
        description: "Assessment that follows each level's needs, with reports from the same records.",
        capabilities: ["Numeric or CBC grading, set per school, grade or class", "CAT and exam scheduling", "Class report cards and competency-based progress reports", "Management reporting with Excel and PDF export"],
      },
      {
        icon: UserCheck,
        title: "Attendance & timetable",
        audience: "Teachers & Administrators",
        description: "Registers per stream and timetables with teacher allocation across your classes.",
        capabilities: ["Stream-based attendance register", "Automatic parent notification", "Timetable and teacher allocation"],
      },
      {
        icon: Building2,
        title: "Campuses",
        audience: "School Groups",
        description: "For owners running more than one campus: oversee them together instead of running disconnected systems.",
        capabilities: ["Cross-campus overview", "Group branding"],
      },
      {
        icon: LayoutGrid,
        title: "Staff, boarding & communication",
        audience: "Administrators",
        description: "Shared staff records and permissions, boarding where you offer it, and one way to reach parents.",
        capabilities: ["Staff directory, roles and permissions", "Boarding: dormitories, roll call and incidents (Growth plan and above)", "SMS and WhatsApp messaging", "Parent portal"],
      },
    ],
    benefits: [
      {
        audience: "School owners & groups",
        icon: Landmark,
        text: "See the whole institution, not one section at a time, and keep one account across your levels or campuses.",
      },
      {
        audience: "Administrators",
        icon: Briefcase,
        text: "One directory, one fee system and one set of permissions instead of a different setup per section.",
      },
      {
        audience: "Teachers",
        icon: Users,
        text: "Record attendance and assessment in the scale that suits their level, in the same platform as everyone else.",
      },
      {
        audience: "Parents",
        icon: BellRing,
        text: "One parent login linked to their children, whichever section they are in, and one dependable channel for school messages.",
      },
    ],
    steps: [
      { title: "Create your school's account", description: "Sign up yourself. No card is required to start the 30-day free trial." },
      { title: "Set up each level's classes", description: "Add classes and streams for every section and map them to their KICD grade levels." },
      { title: "Choose grading per level", description: "Set numeric or CBC competency grading for the school, grade or class as each level needs." },
      { title: "Add learners, staff and campuses", description: "Enrol learners and staff, then add campuses and the modules you need. Prefer a walkthrough first? Book a demo." },
    ],
    faqs: [
      {
        q: "Can one EduCore account cover nursery, primary and junior sections?",
        a: "Yes. Classes can be mapped to KICD grade levels from PP1 through Grade 12, so every section sits in one learner directory, with grading set per school, grade or class.",
      },
      {
        q: "Can a school with multiple campuses use EduCore?",
        a: "Yes — multi-campus support is a real module, letting a school group manage several campuses' data and branding from one account rather than running separate, disconnected instances.",
      },
      FAQ_GRADING,
      {
        q: "How does billing work?",
        a: "EduCore is priced per enrolled student and billed each school term, not a flat monthly platform fee. Which plan fits depends on your student count and which modules you need — the Pricing page has the tier breakdown, and an exact quote comes from a short conversation with the team.",
      },
      FAQ_ISOLATION,
      FAQ_TRIAL,
    ],
    related: ["nursery-kindergarten", "primary-schools", "secondary-schools"],
    heroAlt: "EduCore dashboard preview showing records, fees and campuses for an integrated school",
  },
];

export function getSchoolCategory(slug: string): SchoolCategory | undefined {
  return SCHOOL_CATEGORIES.find((c) => c.slug === slug);
}

export const SCHOOL_CATEGORY_PATHS = SCHOOL_CATEGORIES.map((c) => `/schools/${c.slug}`);
