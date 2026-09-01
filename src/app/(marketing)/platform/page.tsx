import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  NotebookPen,
  TrendingUp,
  UserPlus,
  GraduationCap,
  Users,
  UserCircle,
  Fingerprint,
  Building2,
  HeartPulse,
  ShieldAlert,
  Bus,
  Library as LibraryIcon,
  Wallet,
  Banknote,
  Package,
  MessageCircle,
  MessagesSquare,
  CalendarClock,
  BarChart3,
  Building,
  Plug,
  Sparkles,
  Lock,
} from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { ModuleBlock } from "@/components/marketing/module-block";
import { MiniFrame } from "@/components/marketing/mini-frame";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "School Management System Platform — EduCore Kenya";
const DESCRIPTION =
  "The school ERP modules EduCore runs for Kenyan schools: student management, academics, admissions, fees, and communication, in one connected school management software platform.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/platform" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/platform" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

type Mod = {
  icon: typeof BookOpen;
  title: string;
  audience: string;
  description: string;
  capabilities: string[];
};

const ACADEMICS_MODULES: Mod[] = [
  {
    icon: BookOpen,
    title: "Academics",
    audience: "Teachers & Admins",
    description:
      "Subjects, classes and streams, the academic calendar, and teacher allocation, in one connected structure instead of a folder of spreadsheets rebuilt every term.",
    capabilities: [
      "Subjects, classes, and streams setup",
      "Academic calendar (years & terms)",
      "Timetable and teacher allocation",
      "Automated term rollover",
      "Termly newsletters, reviewed before sending",
    ],
  },
  {
    icon: ClipboardCheck,
    title: "Exams & Grading",
    audience: "Teachers & Academic Heads",
    description:
      "CATs, exams, and marks entry, graded against numeric or CBC competency-based scales set per school, grade, or class — not forced into one model.",
    capabilities: ["CAT and exam scheduling", "Marks entry per exam", "Configurable grading scales (numeric or CBC)"],
  },
  {
    icon: NotebookPen,
    title: "Homework",
    audience: "Teachers, Students & Parents",
    description:
      "Assignments with due dates, tracked submissions, and grading, so homework isn't lost between a notebook and a parent WhatsApp group.",
    capabilities: ["Assignment creation by class/subject", "Submission tracking", "Grading workflow"],
  },
  {
    icon: TrendingUp,
    title: "Teacher Performance",
    audience: "Principals",
    description:
      "A dedicated record of teacher performance, kept alongside the academic data it's actually based on, not in a separate offline process.",
    capabilities: ["Structured performance tracking per teacher"],
  },
];

const PEOPLE_MODULES: Mod[] = [
  {
    icon: UserPlus,
    title: "Admissions",
    audience: "Admissions Officers",
    description:
      "Every applicant tracked from inquiry to enrollment in one pipeline, with a status attached to each one — not a paper register someone forgets to update.",
    capabilities: ["Per-applicant status tracking", "Individual applicant records"],
  },
  {
    icon: GraduationCap,
    title: "Students",
    audience: "Admins & Teachers",
    description:
      "One record per learner — the same student appears the same way whether you're looking at academics, attendance, health, or fees.",
    capabilities: ["Central student directory", "Linked academic, health, and finance records"],
  },
  {
    icon: Users,
    title: "Staff",
    audience: "Admins & HR",
    description:
      "A staff directory that's the single place roles and records are managed, tied into the same permissions Settings controls for the rest of the platform.",
    capabilities: ["Staff directory", "Roles & permissions, managed centrally"],
  },
  {
    icon: UserCircle,
    title: "Parents & Portal",
    audience: "Parents",
    description:
      "A parents directory on the school side, linked to each guardian's children, plus a separate parent login where families see their own child's fees, attendance, and grades directly.",
    capabilities: ["Parent accounts linked to children", "Dedicated parent portal login", "Fees, attendance, and grades visible to parents"],
  },
];

const OPERATIONS_MODULES: Mod[] = [
  {
    icon: Fingerprint,
    title: "Attendance & Biometrics",
    audience: "Teachers & Admins",
    description:
      "Attendance captured by biometric check-in and fed straight into records and parent notifications, or entered by stream when a device isn't in play.",
    capabilities: ["Biometric check-in", "Stream-based attendance register", "Automatic parent notification"],
  },
  {
    icon: Building2,
    title: "Boarding",
    audience: "Boarding Staff",
    description:
      "House and dormitory structure, room and bed allocation, roll call, incidents, and transfers — for schools that run boarding, not bolted on for the ones that don't.",
    capabilities: ["Dormitory, room & bed structure and allocation", "Roll call", "Boarding incidents & transfers", "Boarding-specific reports"],
  },
  {
    icon: HeartPulse,
    title: "Health & Clinic",
    audience: "School Nurses",
    description:
      "Clinic, sick bay, medication, and medical records in one place, with referrals and emergencies tracked the same way.",
    capabilities: ["Sick bay & medication logs", "Medical records & referrals", "Emergency tracking", "Clinic inventory & reports"],
  },
  {
    icon: ShieldAlert,
    title: "Discipline & Welfare",
    audience: "Deans & Principals",
    description:
      "Incidents, cases, and welfare concerns tracked together, with a separate, permission-gated safeguarding record for the cases that need it.",
    capabilities: ["Incident & case tracking", "Welfare concerns", "Permission-gated safeguarding records"],
  },
  {
    icon: Bus,
    title: "Transport",
    audience: "Transport Coordinators",
    description:
      "Routes, vehicles, and stops, with each student's pickup point and vehicle assignment tracked against them.",
    capabilities: ["Route, vehicle & stop management", "Per-student transport assignment"],
  },
  {
    icon: LibraryIcon,
    title: "Library",
    audience: "Librarians & Students",
    description:
      "Catalogue, loans, reservations, shelving, and fines, run the way a school library actually operates rather than a generic inventory list.",
    capabilities: ["Catalogue & loans", "Reservations & shelving", "Fines tracking"],
  },
];

const FINANCE_MODULES: Mod[] = [
  {
    icon: Wallet,
    title: "Finance & Fees",
    audience: "Finance Teams",
    description:
      "Fee structures, invoicing, and per-student accounts, reconciled against M-Pesa payments instead of matched by hand against a paper ledger.",
    capabilities: ["Fee structures & invoicing", "Per-student account balances", "M-Pesa payment reconciliation"],
  },
  {
    icon: Banknote,
    title: "Payroll",
    audience: "Finance & HR",
    description:
      "Salary structures and monthly payroll runs, with NSSF, SHIF, Housing Levy, and PAYE computed against current Kenyan statutory rates.",
    capabilities: ["Salary structure setup", "Monthly payroll runs", "Kenyan statutory deductions computed automatically"],
  },
  {
    icon: Package,
    title: "Inventory & Procurement",
    audience: "Procurement Officers",
    description:
      "Stock, assets, and suppliers, connected to a requisition-to-payment procurement chain instead of spreadsheets that never reconcile with each other.",
    capabilities: ["Stock & asset tracking", "Supplier records", "Procurement & supplier invoices"],
  },
];

const COMMS_MODULES: Mod[] = [
  {
    icon: MessagesSquare,
    title: "EduCore Connect",
    audience: "Teachers & Parents",
    description:
      "Structured, per-student messages from a class teacher to that student's parents — a request, an academic note, an attendance flag — not an open group chat. Parents read, acknowledge, and reply on the thread; only the teacher who raised it can mark it resolved.",
    capabilities: ["Per-student teacher-to-parent items", "Read receipts, acknowledge & reply", "Teacher-only resolution"],
  },
  {
    icon: MessageCircle,
    title: "Communication",
    audience: "Admins & Teachers",
    description:
      "Compose and send updates over WhatsApp and SMS from the same place, with message history and reusable templates instead of an ad hoc phone.",
    capabilities: ["WhatsApp & SMS composing", "Message templates", "Sent-message history"],
  },
  {
    icon: CalendarClock,
    title: "Parent-Teacher Meetings",
    audience: "Teachers & Parents",
    description: "Parent-teacher meetings scheduled and tracked in the platform, not arranged over a chain of phone calls.",
    capabilities: ["Meeting scheduling"],
  },
  {
    icon: BarChart3,
    title: "Reports & Analytics",
    audience: "Principals & Owners",
    description:
      "Management reports exportable to Excel or PDF, pulled from the same live data as every other module — not a manually compiled month-end summary.",
    capabilities: ["Management reporting", "Excel/PDF export"],
  },
];

const PLATFORM_WIDE_MODULES: Mod[] = [
  {
    icon: Building,
    title: "Campuses",
    audience: "School Groups",
    description:
      "For school groups running more than one campus: cross-campus visibility, shared group branding, and group-level API access, alongside each campus's own data isolation.",
    capabilities: ["Cross-campus overview", "Group branding", "Group-level API keys"],
  },
  {
    icon: Plug,
    title: "Integrations",
    audience: "Admins & Finance",
    description:
      "M-Pesa STK push for parent payments, and a NEMIS/KEMIS bulk-upload file generator — Kenya's NEMIS has no public submission API, so EduCore prepares the ministry-format file for you to upload yourself, then tracks that it's done.",
    capabilities: ["M-Pesa STK push payment prompts", "NEMIS/KEMIS bulk-upload file generation"],
  },
  {
    icon: Sparkles,
    title: "Educore AI",
    audience: "School Owners & Principals",
    description:
      "Ask a question about your school's own data and get a grounded answer, alongside the AI features covered in more depth on the AI & Automation page.",
    capabilities: ["Ask-a-question assistant grounded in school data", "Available to School Owner and Principal roles"],
  },
  {
    icon: Lock,
    title: "Administration & Controls",
    audience: "Admins",
    description:
      "Roles and permissions, an audit log, branding, and biometric device management — the controls that sit underneath every module above.",
    capabilities: ["Roles & permissions", "Audit log", "School branding", "Biometric device management"],
  },
];

function ModuleGrid({ modules, tone, cols = 3 }: { modules: Mod[]; tone: "canvas" | "navy"; cols?: 2 | 3 | 4 }) {
  return (
    <div
      className={
        cols === 4
          ? "mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          : cols === 2
            ? "mt-10 grid gap-4 sm:grid-cols-2"
            : "mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      }
    >
      {modules.map((m, i) => (
        <Reveal key={m.title} delayMs={i * 40}>
          <ModuleBlock
            tone={tone}
            icon={m.icon}
            title={m.title}
            audience={m.audience}
            description={m.description}
            capabilities={m.capabilities}
          />
        </Reveal>
      ))}
    </div>
  );
}

export default function PlatformPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Platform", path: "/platform" }]} />
      {/* Hero */}
      <Section tone="navy" className="pt-16 sm:pt-20">
        <Reveal>
          <Eyebrow tone="light">School Management System</Eyebrow>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            The school management system platform, mapped to every real module.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/70">
            Nothing below is a roadmap slide. Every module on this page runs
            inside EduCore today, grouped the way a school actually uses
            them — not the way a sales deck would organize them.
          </p>
        </Reveal>
      </Section>

      {/* Academics & Assessment */}
      <Section id="academics" tone="canvas">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
          <div>
            <Reveal>
              <Eyebrow tone="dark">Academics &amp; Assessment</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
                The academic year, structured once, used everywhere.
              </h2>
              <Link
                href="/cbc-school-management"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-marketing-blue hover:text-marketing-blue/80"
              >
                More on CBC &amp; numeric grading <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Reveal>
            <ModuleGrid modules={ACADEMICS_MODULES} tone="canvas" cols={2} />
          </div>
          <Reveal delayMs={150} className="hidden lg:block">
            <MiniFrame path="app.educore.io/academics/timetable">
              <p className="text-[11px] font-medium text-foreground">This week — Form 3B</p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {[
                  { period: "Mon · P1", subject: "Mathematics" },
                  { period: "Mon · P2", subject: "English" },
                  { period: "Tue · P1", subject: "Chemistry" },
                  { period: "Tue · P3", subject: "CBC — Life Skills" },
                ].map((row) => (
                  <div
                    key={row.period}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">{row.period}</span>
                    <span className="text-[11px] text-foreground">{row.subject}</span>
                  </div>
                ))}
              </div>
            </MiniFrame>
          </Reveal>
        </div>
      </Section>

      {/* Admissions & People */}
      <Section id="admissions" tone="navy">
        <Reveal>
          <Eyebrow tone="light">Admissions &amp; People</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            Every person in the school, one record each.
          </h2>
          <Link
            href="/student-management-system"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-marketing-gold-400 hover:text-marketing-gold-300"
          >
            More on student records &amp; ID cards <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Reveal>
        <ModuleGrid modules={PEOPLE_MODULES} tone="navy" cols={4} />
      </Section>

      {/* Day-to-Day Operations & Student Care */}
      <Section id="operations" tone="canvas">
        <Reveal>
          <Eyebrow tone="dark">Day-to-Day Operations &amp; Student Care</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            The parts of school life that don&rsquo;t stop at the classroom door.
          </h2>
          <Link
            href="/school-attendance-management"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-marketing-blue hover:text-marketing-blue/80"
          >
            More on attendance &amp; biometric check-in <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Reveal>
        <ModuleGrid modules={OPERATIONS_MODULES} tone="canvas" cols={3} />
      </Section>

      {/* Finance & Resources */}
      <Section id="finance" tone="navy">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
          <div>
            <Reveal>
              <Eyebrow tone="light">Finance &amp; Resources</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
                Money and materials, reconciled instead of re-keyed.
              </h2>
              <Link
                href="/finance-fees"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-marketing-gold-400 hover:text-marketing-gold-300"
              >
                More on fees &amp; M-Pesa reconciliation <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Reveal>
            <ModuleGrid modules={FINANCE_MODULES} tone="navy" cols={3} />
          </div>
          <Reveal delayMs={150} className="hidden lg:block">
            <MiniFrame path="app.educore.io/finance/reconciliation">
              <p className="text-[11px] font-medium text-foreground">M-Pesa reconciliation</p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {[
                  { ref: "TGH4K9P2X1", status: "Matched", tone: "success" as const },
                  { ref: "TGH4K9Q7Z3", status: "Matched", tone: "success" as const },
                  { ref: "TGH4K9R0A8", status: "Pending", tone: "warning" as const },
                ].map((row) => (
                  <div
                    key={row.ref}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">{row.ref}</span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "font-mono text-[9px]",
                        row.tone === "success" && "bg-success-subtle text-success",
                        row.tone === "warning" && "bg-warning-subtle text-warning",
                      )}
                    >
                      {row.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </MiniFrame>
          </Reveal>
        </div>
      </Section>

      {/* Communication & Reporting */}
      <Section id="communication" tone="canvas">
        <Reveal>
          <Eyebrow tone="dark">Communication &amp; Reporting</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Keeping everyone in the loop, and knowing what happened after.
          </h2>
          <Link
            href="/parent-communication"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-marketing-blue hover:text-marketing-blue/80"
          >
            More on WhatsApp, SMS &amp; the parent portal <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Reveal>
        <ModuleGrid modules={COMMS_MODULES} tone="canvas" cols={3} />
      </Section>

      {/* Multi-Campus, Integrations & AI */}
      <Section id="integrations" tone="navy">
        <Reveal>
          <Eyebrow tone="light">Multi-Campus, Integrations &amp; AI</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            What connects EduCore to the rest of how a school runs.
          </h2>
          <Link
            href="/security"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-marketing-gold-400 hover:text-marketing-gold-300"
          >
            How data stays isolated between schools <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Reveal>
        <ModuleGrid modules={PLATFORM_WIDE_MODULES} tone="navy" cols={4} />
      </Section>

      {/* Final CTA */}
      <Section tone="canvas">
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-marketing-navy-900/10 bg-white px-6 py-16 text-center">
          <Eyebrow tone="dark">Get Started</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            See these modules running your school&rsquo;s own setup.
          </h2>
          <p className="max-w-xl text-marketing-navy-900/65">
            A demo walks through the modules that matter to your school —
            not a generic tour of everything on this page.
          </p>
          <MarketingButton size="lg" asChild className="mt-2">
            <Link href="/contact">
              Book a Demo <ArrowRight className="h-4 w-4" />
            </Link>
          </MarketingButton>
        </Reveal>
      </Section>
    </>
  );
}
