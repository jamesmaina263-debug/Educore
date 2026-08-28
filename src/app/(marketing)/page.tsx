import Link from "next/link";
import {
  ArrowRight,
  UserPlus,
  GraduationCap,
  BookOpen,
  Wallet,
  MessageCircle,
  Building2,
  Users,
  BarChart3,
  UserCircle,
  Fingerprint,
  Sparkles,
  CalendarClock,
  ShieldCheck,
  WifiOff,
  Smartphone,
  Landmark,
} from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { DashboardFrame } from "@/components/marketing/dashboard-frame";
import { FeatureCard } from "@/components/marketing/feature-card";

const PLATFORM_MODULES = [
  { icon: UserPlus, title: "Admissions", description: "From inquiry to enrollment, tracked in one pipeline instead of scattered forms and phone calls." },
  { icon: GraduationCap, title: "Student Management", description: "One record per student — academic, disciplinary, medical, and family — not five spreadsheets." },
  { icon: BookOpen, title: "Academics", description: "Numeric and CBC competency-based grading, supported side by side at the school, grade, or class level." },
  { icon: Wallet, title: "Finance & Fees", description: "Invoicing, payments, and reconciliation, with M-Pesa built in for the way Kenyan schools actually get paid." },
  { icon: MessageCircle, title: "Communication", description: "Reach parents over WhatsApp and SMS from the same place you manage everything else." },
  { icon: Building2, title: "Boarding", description: "Dormitories, house allocation, and boarding-specific records, built for schools that need them." },
  { icon: Users, title: "Staff Management", description: "Payroll, leave, and staff records that run on their own schedule every month." },
  { icon: BarChart3, title: "Reports & Analytics", description: "Export to Excel or PDF when you need it, without waiting on someone to compile it by hand." },
  { icon: UserCircle, title: "Parent Portal", description: "A dedicated login for parents to see fees, grades, and attendance — no spreadsheets emailed home." },
  { icon: Fingerprint, title: "Attendance & Biometrics", description: "Biometric check-in that feeds directly into attendance records and parent notifications." },
];

const OUTCOMES = [
  { title: "Fees collected on time", description: "Invoices, M-Pesa payments, and reconciliation in one flow — not three separate systems that don't talk to each other." },
  { title: "Every admission tracked, start to finish", description: "No applicant falls through the cracks between a walk-in inquiry and a confirmed enrollment." },
  { title: "One source of truth per student", description: "Academics, attendance, health, and finance for every student live in one record, not five." },
  { title: "Parents reached when it matters", description: "Fee reminders and updates land on WhatsApp, not in a notebook that goes home and never comes back." },
  { title: "Attendance that captures itself", description: "Biometric check-in updates attendance and notifies parents automatically, without a manual register." },
  { title: "Payroll that runs on schedule", description: "Staff payroll and leave tracked in the same platform as everything else your school runs." },
];

const AI_FEATURES = [
  {
    icon: Sparkles,
    title: "AI-assisted report card comments",
    description: "Teachers get a strong first draft of narrative comments for every learner, grounded in that student's actual performance — theirs to review and edit, never sent unreviewed.",
  },
  {
    icon: MessageCircle,
    title: "Parent communication over WhatsApp",
    description: "Term newsletters and fee-threshold alerts go out where parents already are, drafted for staff to approve before anything sends.",
  },
  {
    icon: CalendarClock,
    title: "Timetable automation",
    description: "Generate a full school timetable automatically instead of building it period by period by hand.",
  },
];

const ROLES = [
  { role: "School Owners", value: "See the whole operation — enrollment, fees, staffing — in one place instead of piecing it together from separate systems." },
  { role: "Principals", value: "Move between academics, discipline, and staff oversight without switching tools." },
  { role: "Administrators", value: "Admissions, records, and reporting handled in one platform instead of parallel spreadsheets." },
  { role: "Teachers", value: "Attendance, grading, and report comments in one place, with AI handling the first draft of the writing." },
  { role: "Finance Teams", value: "Invoicing, M-Pesa payments, and reconciliation without re-keying anything between systems." },
  { role: "Parents", value: "One login to see fees, attendance, and grades — and updates that reach you on WhatsApp." },
  { role: "Students", value: "A clearer academic record, and a school that runs on time because the back office finally does too." },
];

const TRUST_POINTS = [
  { icon: Landmark, title: "M-Pesa built in", description: "Fee payments reconcile automatically instead of being matched by hand against a paper ledger." },
  { icon: ShieldCheck, title: "Isolated per school", description: "Every school's data is architecturally separated at the database level — one school's records are never visible to another." },
  { icon: WifiOff, title: "Built for patchy connectivity", description: "Core workflows queue and sync when the connection drops, instead of losing work." },
  { icon: Smartphone, title: "Two grading models, natively", description: "Numeric and CBC competency-based grading are both supported from the ground up — pick per school, grade, or class." },
];

export default function MarketingHomePage() {
  return (
    <>
      {/* 1 & 2 & 3 & 4 — Hero: value proposition, primary/secondary CTA, Dashboard Frame */}
      <Section tone="navy" className="pt-16 sm:pt-20">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <Reveal>
            <Eyebrow tone="light">School Management, Unified</Eyebrow>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.25rem]">
              Every part of running a school, on one connected platform.
            </h1>
            <p className="mt-6 max-w-lg text-lg text-white/70">
              EduCore brings admissions, academics, finance, attendance, and
              parent communication into a single system — so your team stops
              reconciling spreadsheets and starts running the school.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <MarketingButton size="lg" asChild>
                <Link href="/contact">
                  Book a Demo <ArrowRight className="h-4 w-4" />
                </Link>
              </MarketingButton>
              <MarketingButton size="lg" variant="outline-on-dark" asChild>
                <Link href="/platform">Explore EduCore</Link>
              </MarketingButton>
            </div>
          </Reveal>

          <Reveal delayMs={150}>
            <DashboardFrame />
          </Reveal>
        </div>
      </Section>

      {/* 2 (continued) — Value proposition / problem-solution */}
      <Section tone="canvas">
        <Reveal>
          <Eyebrow tone="dark">The Problem</Eyebrow>
          <h2 className="mt-4 max-w-2xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Most schools run on five systems that were never meant to talk to each other.
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-marketing-navy-900/70">
            A fee spreadsheet here, a WhatsApp group there, an admissions
            notebook at the front desk, a separate payroll process at month
            end. Nothing is wrong with any one of them — the problem is that
            none of them share the same picture of the school.
          </p>
        </Reveal>
        <Reveal delayMs={150}>
          <p className="mt-6 max-w-2xl text-lg font-medium text-marketing-navy-950">
            EduCore replaces the patchwork with one platform every role in the
            school actually uses.
          </p>
        </Reveal>
      </Section>

      {/* 5 — Platform / module overview */}
      <Section tone="navy">
        <Reveal>
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <Eyebrow tone="light">The Platform</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
                One system, every module a school needs.
              </h2>
            </div>
            <Link
              href="/platform"
              className="flex items-center gap-1.5 text-sm font-medium text-marketing-gold-400 hover:text-marketing-gold-300"
            >
              See the full platform <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORM_MODULES.map((mod, i) => (
            <Reveal key={mod.title} delayMs={i * 40}>
              <FeatureCard tone="navy" icon={mod.icon} title={mod.title} description={mod.description} />
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 6 — Benefits / outcomes */}
      <Section tone="canvas">
        <Reveal>
          <Eyebrow tone="dark">Outcomes</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            What changes when everything is in one place.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {OUTCOMES.map((o, i) => (
            <Reveal key={o.title} delayMs={i * 40} className="flex gap-4">
              <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-marketing-gold-500" />
              <div>
                <h3 className="font-semibold text-marketing-navy-950">{o.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-marketing-navy-900/65">
                  {o.description}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 7 — AI & Automation */}
      <Section tone="navy">
        <Reveal>
          <Eyebrow tone="light">AI &amp; Automation</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            The parts of the job worth automating — already live.
          </h2>
          <p className="mt-4 max-w-xl text-white/65">
            Not a roadmap slide. These run inside EduCore today.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {AI_FEATURES.map((f, i) => (
            <Reveal key={f.title} delayMs={i * 60}>
              <FeatureCard tone="navy" icon={f.icon} title={f.title} description={f.description} />
            </Reveal>
          ))}
        </div>
        <Reveal delayMs={200}>
          <Link
            href="/ai-automation"
            className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-marketing-gold-400 hover:text-marketing-gold-300"
          >
            More on AI &amp; Automation <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Reveal>
      </Section>

      {/* 8 — Role-based value */}
      <Section tone="canvas">
        <Reveal>
          <Eyebrow tone="dark">Built for every role</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Different job, same platform.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-marketing-navy-900/10 bg-marketing-navy-900/10 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r, i) => (
            <Reveal key={r.role} delayMs={i * 30} className="bg-white p-6">
              <p className="font-mono text-xs font-medium uppercase tracking-[0.1em] text-marketing-blue">
                {r.role}
              </p>
              <p className="mt-2.5 text-sm leading-relaxed text-marketing-navy-900/75">
                {r.value}
              </p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 9 — Trust / proof structure, no invented stats or customers */}
      <Section tone="canvas" className="pt-0 sm:pt-0">
        <Reveal>
          <Eyebrow tone="dark">Why EduCore</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Built for how Kenyan schools actually run.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_POINTS.map((t, i) => (
            <Reveal key={t.title} delayMs={i * 40}>
              <FeatureCard tone="canvas" icon={t.icon} title={t.title} description={t.description} />
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 10 — Final conversion CTA */}
      <Section tone="navy">
        <Reveal className="flex flex-col items-center gap-6 text-center">
          <Eyebrow tone="light">Get Started</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            See EduCore running your school&rsquo;s own workflows.
          </h2>
          <p className="max-w-xl text-white/65">
            A demo is built around your admissions, fees, and academics
            setup &mdash; not a generic tour.
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
