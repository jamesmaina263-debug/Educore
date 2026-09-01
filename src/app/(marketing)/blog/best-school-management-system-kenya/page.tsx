import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPin, Layers, Wifi, ShieldCheck, Users } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "Best School Management System in Kenya (2026 Guide) — EduCore";
const DESCRIPTION =
  "What actually separates a school management system schools keep using from one that gets abandoned for spreadsheets — M-Pesa, CBC grading, offline resilience, and real data isolation, evaluated for Kenyan schools.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog/best-school-management-system-kenya" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/blog/best-school-management-system-kenya" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const CRITERIA = [
  {
    icon: MapPin,
    title: "Kenya-specific fit",
    description:
      "M-Pesa should be a native part of fee collection, not an afterthought — it's how most Kenyan parents actually pay. CBC assessment support matters just as much as numeric grading for most schools today.",
  },
  {
    icon: Layers,
    title: "One system, not five",
    description:
      "The real cost of school administration isn't any single task — it's reconciling a fee spreadsheet against a paper register against a separate admissions notebook. Look for one shared, current picture of the school.",
  },
  {
    icon: Wifi,
    title: "Built for patchy connectivity",
    description:
      "Internet reliability varies a lot across Kenyan schools, especially outside major towns. A system that queues actions locally and syncs once connectivity returns holds up far better than one that simply fails offline.",
  },
  {
    icon: ShieldCheck,
    title: "Real data isolation",
    description:
      "For any system handling student and financial records, ask directly how school data is separated. Row-level security enforced at the database level is a stronger guarantee than an app that only filters what's shown on screen.",
  },
  {
    icon: Users,
    title: "Support that understands how Kenyan schools run",
    description:
      "Onboarding speed, response times, and whether the vendor understands term structures, KNEC reporting, and local fee cycles tend to matter more day to day than a long feature list.",
  },
];

const STEPS = [
  "Ask for a demo built around your school's actual admissions and fee structure — not a generic product tour.",
  "Confirm how fee reconciliation actually works, especially around M-Pesa, since this is where manual processes cost schools the most time.",
  "Check whether CBC and numeric grading are both genuinely supported, if your school needs either or both.",
  "Ask what happens when connectivity drops mid-task, and whether work is lost or simply queued.",
  "Talk to a school already using the system, if the vendor can connect you with one.",
];

export default function BestSchoolManagementSystemKenyaPost() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Best School Management System in Kenya", path: "/blog/best-school-management-system-kenya" }]} />
      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Best School Management System in Kenya: A 2026 Guide
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Choosing a school management system touches admissions, fees,
          attendance, academics, and how well parents stay in the loop. Get
          it right and the back office finally runs as smoothly as the
          classroom. Here&apos;s what actually separates the systems schools
          keep using from the ones that quietly get abandoned for
          spreadsheets and WhatsApp within a term.
        </p>
      </Section>

      {/* 2 — What to look for */}
      <Section tone="canvas">
        <Reveal>
          <Eyebrow>What to Actually Look For</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Five things that separate real adoption from another abandoned system.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-8 sm:grid-cols-2">
          {CRITERIA.map((item) => (
            <Reveal key={item.title}>
              <item.icon className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
              <p className="mt-3 text-sm font-semibold text-marketing-navy-950">
                {item.title}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
                {item.description}
              </p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 3 — Where EduCore fits */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Where EduCore Fits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Built specifically around how Kenyan schools operate day to day.
          </h2>
          <ul className="mt-6 flex flex-col gap-3 text-base leading-relaxed text-white/75">
            <li>
              <span className="font-semibold text-white">M-Pesa built in</span> —
              fee payments reconcile automatically against invoices instead of
              being matched by hand against a paper ledger.
            </li>
            <li>
              <span className="font-semibold text-white">Both grading models, natively</span> —
              numeric and CBC competency-based grading are supported side by
              side, configurable per school, grade, or class.
            </li>
            <li>
              <span className="font-semibold text-white">Per-school data isolation</span> —
              every school&apos;s records are separated at the database level
              through row-level security policies.
            </li>
            <li>
              <span className="font-semibold text-white">Built for unreliable connectivity</span> —
              core workflows queue and sync rather than fail outright when a
              connection drops.
            </li>
            <li>
              <span className="font-semibold text-white">One connected platform</span> —
              admissions, student records, academics, finance, attendance,
              staff payroll, and parent communication all in one place.
            </li>
            <li>
              <span className="font-semibold text-white">Parents reached where they already are</span> —
              fee reminders and updates go out over WhatsApp and SMS.
            </li>
          </ul>
        </Reveal>
      </Section>

      {/* 4 — How to evaluate */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Before You Commit</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Five practical steps, whichever system you&apos;re considering.
          </h2>
          <ol className="mt-6 flex flex-col gap-3 text-base leading-relaxed text-marketing-navy-900/75">
            {STEPS.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="font-semibold text-marketing-gold-600">
                  {i + 1}.
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Reveal>
      </Section>

      {/* 5 — Final CTA */}
      <Section tone="navy" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow tone="dark">Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            See whether EduCore fits your school.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            A demo is built around your admissions, fees, and academics
            setup — not a generic tour.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/contact">
                Book a Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/platform">Explore the Platform</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
