import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  ClipboardList,
  GraduationCap,
  MessageSquare,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";
import { RelatedGuides } from "@/components/marketing/related-guides";

const PATH = "/blog/what-is-a-school-management-system-kenya";
const PUBLISHED = "2026-10-11";
const TITLE = "What Is a School Management System? A Kenya Guide — EduCore";
const DESCRIPTION =
  "What a school management system is, what it does, and what to look for in Kenya: CBC grading, M-Pesa fees, parent communication and data protection.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH, images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

// Claims about EduCore below are limited to facts already published and
// verified elsewhere on this site, so this page can't drift from what's real:
//   - module list: (marketing)/platform/page.tsx
//   - M-Pesa built into the finance module, numeric + CBC grading per
//     school/grade/class, queue-and-sync on a dropped connection, per-school
//     data isolation via row-level security, parent portal, 30-day free
//     trial with no card, nothing auto-deleted at trial end:
//     (marketing)/faq/page.tsx and src/lib/marketing/trial.ts
//   - flat KES 100 per student, per term: (marketing)/pricing/page.tsx
// Everything else is general, vendor-neutral explanation of the category.

const CORE_AREAS = [
  {
    icon: ClipboardList,
    title: "Admissions",
    body: "Inquiries, applications and enrolment tracked in one pipeline, not scattered across forms and phone calls.",
  },
  {
    icon: Users,
    title: "Student records",
    body: "One record per learner: guardians, class history, medical and discipline notes, certificates.",
  },
  {
    icon: GraduationCap,
    title: "Academics and exams",
    body: "Marks, grading, report cards and class performance, for numeric and competency-based (CBC) grading.",
  },
  {
    icon: CalendarCheck,
    title: "Attendance",
    body: "Daily registers by class, with absences recorded and, where the system supports it, parents alerted.",
  },
  {
    icon: Wallet,
    title: "Fees and finance",
    body: "Fee structures, invoices, payments and balances, with M-Pesa payments matched to the right learner.",
  },
  {
    icon: UserCog,
    title: "Staff and payroll",
    body: "Staff records, roles and what each person is allowed to see or change.",
  },
  {
    icon: MessageSquare,
    title: "Parent communication",
    body: "Notices, fee reminders and results reaching parents by SMS, WhatsApp or a parent portal.",
  },
  {
    icon: BarChart3,
    title: "Reports",
    body: "Enrolment, attendance, fee collection and performance in one view for the head and the board.",
  },
];

const CHOOSING = [
  {
    q: "Does it handle CBC and numeric grading?",
    a: "Many schools are mid-transition, so look for both grading models running side by side, and CBC marks recorded at sub-strand level rather than as a single score.",
  },
  {
    q: "How does it handle M-Pesa?",
    a: "Ask whether payments are matched to a learner automatically or someone still reconciles a statement by hand. For many bursars this is the biggest time-saver.",
  },
  {
    q: "What happens when the internet drops?",
    a: "School connections are rarely perfect. Ask what a teacher can still do offline, and whether work syncs afterwards instead of being lost.",
  },
  {
    q: "Where does our data live, and who can see it?",
    a: "Each school's records should be separated from every other school's, with role-based access inside the school. See our guide to the Data Protection Act for schools.",
  },
  {
    q: "Is it web-based or installed on one computer?",
    a: "Software installed on a single computer ties your records to that machine. A web-based system opens from any device, but depends on a connection, which is why the offline question matters.",
  },
  {
    q: "What does it really cost?",
    a: "Compare the whole price: per-student or flat, per term or per year, and which modules sit behind higher tiers. Our guide to free school software covers where costs hide.",
  },
];

const FAQS = [
  {
    q: "What is a school management system?",
    a: "A school management system (SMS) is software that keeps a school's records and routines in one place: admissions, student records, grades, attendance, fees, staff and parent communication. It replaces separate spreadsheets, paper registers and fee ledgers with one connected system.",
  },
  {
    q: "What is the difference between a school management system and a student information system?",
    a: "A student information system (SIS) mainly holds student records: enrolment, grades and attendance. A school management system is broader. It usually adds fees and finance, staff and payroll, communication and reporting on top of the student records.",
  },
  {
    q: "Does a Kenyan school need one that supports CBC?",
    a: "If the school teaches CBC, yes. CBC assessment is recorded by strand and sub-strand using four competency levels rather than a single percentage, so the system needs to store and report marks that way. EduCore supports both CBC and numeric grading, set per school, grade or class.",
  },
  {
    q: "Can parents see fee balances and results?",
    a: "That depends on the system. With EduCore, a guardian can log in to a parent portal to see their child's fee balance, report card and payments.",
  },
  {
    q: "Is it safe to keep student data in a school management system?",
    a: "It can be, if the system separates each school's data and controls who can see what. In EduCore, each school's data is isolated at the database level using row-level security, so one school's records are never visible to another.",
  },
  {
    q: "How much does a school management system cost in Kenya?",
    a: "Prices vary by vendor and by model, so compare per-student against flat fees and check what each tier includes. EduCore charges a flat KES 100 per student, per term across all plans, with plans differing by modules and support, not price.",
  },
  {
    q: "Can we try EduCore before paying?",
    a: "Yes. Every school gets a 30-day free trial with no card required. When it ends, sign-in is paused until a plan is agreed, and nothing is deleted automatically.",
  },
];

export default function WhatIsASchoolManagementSystemPost() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          HOME_CRUMB,
          { name: "Blog", path: "/blog" },
          { name: "What Is a School Management System?", path: PATH },
        ]}
      />
      <ArticleJsonLd
        headline={TITLE}
        description={DESCRIPTION}
        path={PATH}
        datePublished={PUBLISHED}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* 1: Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          What Is a School Management System? A Practical Guide for Kenyan Schools
        </h1>
        <BlogByline publishedOn={PUBLISHED} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          If your school still runs on spreadsheets, paper registers and a
          fee ledger, this is the software that replaces them. Here is what a
          school management system does, what Kenyan schools should expect
          from one, and the questions worth asking before you choose.
        </p>
      </Section>

      {/* 2: Quick answer */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Quick Answer</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            What is a school management system?
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-marketing-navy-900/80">
            A school management system (SMS) is software that keeps a school&apos;s
            records and routines in one place: admissions, student records,
            grades, attendance, fees, staff and parent communication. In
            Kenya, a good one also handles CBC grading, M-Pesa fee payments
            and parent updates by SMS or WhatsApp.
          </p>
        </Reveal>

        {/* 3: What it does */}
        <Reveal className="mx-auto mt-16 max-w-5xl">
          <div className="mx-auto max-w-3xl">
            <Eyebrow>What It Covers</Eyebrow>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
              What does a school management system actually do?
            </h2>
            <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/75">
              Systems differ in depth, but most cover the same eight areas.
              The difference is whether they share one record of each learner
              or keep separate lists that someone has to reconcile.
            </p>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {CORE_AREAS.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-2xl border border-marketing-navy-900/10 p-5"
              >
                <Icon className="h-5 w-5 text-marketing-navy-950" aria-hidden />
                <p className="mt-3 text-sm font-semibold text-marketing-navy-950">
                  {title}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </Section>

      {/* 4: What it replaces */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">The Problem</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            What does it replace?
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              Most schools start with whatever is at hand: an Excel file for
              marks, a paper register for attendance, a fee ledger kept by
              the bursar, and a WhatsApp group for parents. Each one works
              until you need to connect them.
            </p>
            <p>
              A parent asks why their child is marked absent while the fee
              statement says paid. The head wants fee arrears by class for
              the board. A teacher needs last term&apos;s marks to write a
              report. With separate files, someone has to piece the answer
              together by hand. With one system, it is a single lookup.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 5: Choosing */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Choosing One</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            What should a Kenyan school look for?
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/75">
            A system built for another country can look polished and still
            miss how Kenyan schools work. These six questions separate the
            ones that fit from the ones that don&apos;t.
          </p>
          <div className="mt-8 flex flex-col gap-6">
            {CHOOSING.map((c) => (
              <div key={c.q}>
                <p className="text-base font-semibold text-marketing-navy-950">{c.q}</p>
                <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
                  {c.a}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm leading-relaxed text-marketing-navy-900/70">
            For a longer comparison, read our{" "}
            <Link
              href="/blog/best-school-management-system-kenya"
              className="font-semibold underline underline-offset-4"
            >
              2026 guide to the best school management system in Kenya
            </Link>
            , and our{" "}
            <Link
              href="/blog/data-protection-act-kenya-schools-guide"
              className="font-semibold underline underline-offset-4"
            >
              Data Protection Act guide for schools
            </Link>
            .
          </p>
        </Reveal>
      </Section>

      {/* 6: How EduCore fits */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">EduCore</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            How EduCore fits
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              EduCore is a school management platform built for Kenyan
              schools. It covers admissions, academics with CBC and numeric
              grading, finance with M-Pesa built in, attendance, staff and
              payroll, and parent communication, in one connected system. The{" "}
              <Link
                href="/platform"
                className="font-semibold text-marketing-gold-400 underline underline-offset-4"
              >
                platform page
              </Link>{" "}
              lists every module.
            </p>
            <p>
              Pricing is a flat KES 100 per student, per term across all
              plans (see{" "}
              <Link
                href="/pricing"
                className="font-semibold text-marketing-gold-400 underline underline-offset-4"
              >
                pricing
              </Link>
              ), and every school gets a 30-day free trial with no card
              required.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 7: FAQ */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Common Questions</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-8 flex flex-col gap-6">
            {FAQS.map((f) => (
              <div key={f.q}>
                <p className="text-base font-semibold text-marketing-navy-950">{f.q}</p>
                <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
                  {f.a}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </Section>

      {/* 8: CTA */}
      <Section tone="navy" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow tone="dark">Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Try EduCore with your own school&apos;s data.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            Start a 30-day free trial with no card, or book a demo and we
            will walk through the modules that fit your school.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/signup">
                Start Free Trial <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/contact">Book a Demo</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
      <RelatedGuides slug="what-is-a-school-management-system-kenya" />
    </>
  );
}
