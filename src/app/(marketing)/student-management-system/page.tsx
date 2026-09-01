import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  GraduationCap,
  UserPlus,
  HeartPulse,
  ShieldAlert,
  Award,
  Users,
  Fingerprint,
  IdCard,
} from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { ModuleBlock } from "@/components/marketing/module-block";
import { MiniFrame } from "@/components/marketing/mini-frame";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "Student Management System Kenya — EduCore";
const DESCRIPTION =
  "One student record per learner — admissions, academics, discipline, medical, guardians, and ID cards — instead of five spreadsheets. The student management system built for Kenyan schools.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/student-management-system" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/student-management-system" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Every capability below matches a real tab/page under (app)/students/[id]/
// (discipline-tab.tsx, medical-tab.tsx, guardians-tab.tsx, certificates-tab.tsx,
// id-card/page.tsx) or (app)/admissions -- verified by reading those files
// directly before writing this copy, per the ground rules in
// MARKETING_SITE_STATUS.md. Nothing here is a roadmap item.
const STUDENT_MODULES = [
  {
    icon: UserPlus,
    title: "Admissions to Enrollment",
    audience: "Admissions Officers",
    description:
      "Every applicant tracked from first inquiry to confirmed enrollment in one pipeline, with a status attached to each one — no applicant falls through the cracks between a walk-in and a signed-up student.",
    capabilities: ["Per-applicant status tracking", "Individual applicant records", "Converts directly into a student record on enrollment"],
  },
  {
    icon: GraduationCap,
    title: "One Record Per Student",
    audience: "Admins & Teachers",
    description:
      "The same student appears the same way everywhere — academics, attendance, health, discipline, and finance all point back to one record, not five spreadsheets that quietly drift out of sync.",
    capabilities: ["Central student directory", "Linked academic, health, discipline, and finance data", "No duplicate records to reconcile"],
  },
  {
    icon: Users,
    title: "Guardians & Family Records",
    audience: "Admins & Parents",
    description:
      "Each student's guardians are recorded and linked directly to the parent portal login — so the right family sees the right child's fees, attendance, and grades, and nothing else.",
    capabilities: ["Guardian records per student", "Linked to parent portal access", "Supports multiple guardians per learner"],
  },
  {
    icon: HeartPulse,
    title: "Medical Records",
    audience: "Admins & School Nurses",
    description:
      "A student's medical history lives on their record, not in a separate paper file in the sick bay — visible to the staff who need it, when they need it.",
    capabilities: ["Per-student medical history", "Tied to the school's health module"],
  },
  {
    icon: ShieldAlert,
    title: "Discipline Records",
    audience: "Admins & Principals",
    description:
      "Incidents and disciplinary cases attach to the student's own record, giving a real history instead of scattered notes in different teachers' notebooks.",
    capabilities: ["Incident and case history per student", "Tied to the school's discipline module"],
  },
  {
    icon: Award,
    title: "Certificates",
    audience: "Admins",
    description:
      "Certificates generated directly from a student's own record, instead of retyped by hand from a template each time one is needed.",
    capabilities: ["Certificate generation per student"],
  },
];

export default function StudentManagementSystemPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Student Management System", path: "/student-management-system" }]} />
      <Section tone="navy" className="pt-16 sm:pt-20">
        <Reveal>
          <Eyebrow tone="light">Student Management</Eyebrow>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            A student management system built for Kenyan schools — one record per learner, not five.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/70">
            Academics, attendance, medical history, discipline, guardians, and
            fees all point back to the same student record — so the same
            learner doesn&apos;t look different depending on which
            spreadsheet you happen to open.
          </p>
        </Reveal>
      </Section>

      <Section tone="canvas">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
          <div>
            <Reveal>
              <Eyebrow tone="dark">One Record, Every Department</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
                A student ID card is one click away, not a design job.
              </h2>
              <p className="mt-4 max-w-xl text-marketing-navy-900/70">
                Every student record can generate its own ID card directly
                from the data already on file — no separate design tool, no
                retyping a name and admission number by hand. Biometric
                check-in (where a school uses it) feeds straight into the
                same attendance record, so a student&apos;s presence is
                captured automatically instead of marked from a paper
                register at the end of the day.
              </p>
            </Reveal>
          </div>
          <Reveal delayMs={150} className="hidden lg:block">
            <MiniFrame path="app.educore.io/students/128">
              <p className="text-[11px] font-medium text-foreground">Amina Wanjiru — Grade 7</p>
              <div className="mt-2.5 flex flex-col gap-1.5 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5">
                  <IdCard className="h-3 w-3" /> Admission No. EDU-0128
                </div>
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5">
                  <Fingerprint className="h-3 w-3" /> Attendance: Present today
                </div>
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5">
                  <Users className="h-3 w-3" /> Guardian: J. Wanjiru (Portal linked)
                </div>
              </div>
            </MiniFrame>
          </Reveal>
        </div>
      </Section>

      <Section tone="navy">
        <Reveal>
          <Eyebrow tone="light">What&apos;s On Every Record</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            Six things every school tracks about a student, in one place.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STUDENT_MODULES.map((m, i) => (
            <Reveal key={m.title} delayMs={i * 40}>
              <ModuleBlock
                tone="navy"
                icon={m.icon}
                title={m.title}
                audience={m.audience}
                description={m.description}
                capabilities={m.capabilities}
              />
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="canvas">
        <Reveal>
          <div className="rounded-2xl border border-marketing-navy-900/10 bg-white p-6">
            <p className="text-sm font-semibold text-marketing-navy-950">
              Works alongside the rest of the platform, not instead of it
            </p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/65">
              Student records connect directly to{" "}
              <Link href="/cbc-school-management" className="text-marketing-blue underline underline-offset-2">
                CBC and numeric grading
              </Link>
              ,{" "}
              <Link href="/finance-fees" className="text-marketing-blue underline underline-offset-2">
                fee accounts and M-Pesa reconciliation
              </Link>
              , and the rest of the{" "}
              <Link href="/platform" className="text-marketing-blue underline underline-offset-2">
                full platform
              </Link>
              . One student, one record, everywhere it&apos;s needed.
            </p>
          </div>
        </Reveal>
      </Section>

      <Section tone="navy">
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <Eyebrow tone="light">Get Started</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            See your own students&rsquo; records, not a sample school.
          </h2>
          <p className="max-w-xl text-white/70">
            A demo is built around how your school actually organizes
            students — classes, streams, and all.
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
