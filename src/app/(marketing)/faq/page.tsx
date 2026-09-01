import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "FAQ — EduCore";
const DESCRIPTION =
  "Answers to common questions about EduCore: modules, data security, offline support, M-Pesa, AI features, multi-campus schools, and how billing works.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/faq" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/faq" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Every answer below restates a fact already verified against the
// codebase in an earlier phase (RLS isolation / offline queueing / dual
// grading models -- homepage trust points, Phase 3; M-Pesa -- same;
// AI-is-Enterprise-only -- subscription_plans.features jsonb, Phase 7;
// multi-campus -- the real campuses module, Phase 4 Platform page) or is
// a plain restatement of the pricing structure from Phase 7. Nothing here
// introduces a new claim that hasn't already been grounded elsewhere on
// the site -- deliberately, so this page can't drift from what's real.
const FAQS = [
  {
    q: "What is EduCore?",
    a: "EduCore is a school management platform that brings admissions, academics, finance, attendance, and parent communication into one connected system, so a school's team isn't reconciling the same information across spreadsheets, paper registers, and separate tools.",
  },
  {
    q: "Which modules are included?",
    a: "That depends on the plan. Starter covers core student and staff records, academics, and finance. Growth adds payroll, library, transport, boarding, inventory, and communication. Enterprise includes the full module set plus AI features. The Platform page has the complete breakdown of what each module does.",
  },
  {
    q: "Is our school's data isolated from other schools on EduCore?",
    a: "Yes. Every school's data is architecturally separated at the database level — one school's records are never visible to another, enforced by row-level security rather than application-level checks alone.",
  },
  {
    q: "Does EduCore work if our internet connection is unreliable?",
    a: "Core workflows are built to queue and sync when a connection drops, rather than losing work — this matters in practice because school offices and classrooms don't always have consistent connectivity.",
  },
  {
    q: "Does EduCore support M-Pesa for fee payments?",
    a: "Yes, M-Pesa is built into the finance module, so fee payments reconcile automatically instead of being matched by hand against a paper ledger.",
  },
  {
    q: "Are the AI features actually live, or a roadmap promise?",
    a: "The AI features described as live, are live — grounded in a school's own real data and drafted for a person to review, never sent unreviewed. AI features are part of the Enterprise plan. The AI & Automation page is explicit about what's live today versus anything still in development.",
  },
  {
    q: "How does billing work?",
    a: "EduCore is priced per enrolled student and billed each school term, not a flat monthly platform fee. Which plan fits depends on your student count and which modules you need — the Pricing page has the tier breakdown, and an exact quote comes from a short conversation with the team.",
  },
  {
    q: "Can a school with multiple campuses use EduCore?",
    a: "Yes — multi-campus support is a real module, letting a school group manage several campuses' data and branding from one account rather than running separate, disconnected instances.",
  },
  {
    q: "Does EduCore support both numeric and competency-based (CBC) grading?",
    a: "Yes, both grading models are supported from the ground up, and can be set per school, grade, or class rather than forcing every school onto one system.",
  },
  {
    q: "How do we get started?",
    a: "Book a demo and the team will walk through which modules and plan fit your school's size — there's no need to guess at that ahead of time.",
  },
];

export default function FaqPage() {
  const jsonLd = {
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
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "FAQ", path: "/faq" }]} />
      {/* Structured data for search engines -- mirrors the visible Q&A
          below exactly, so it can never say something the page doesn't. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">FAQ</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Questions schools actually ask before switching.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          If something below doesn&apos;t cover your situation, a short
          conversation usually will.
        </p>
      </Section>

      {/* 2 — Q&A list */}
      <Section tone="canvas">
        <Reveal>
          <dl className="mx-auto max-w-3xl divide-y divide-marketing-navy-900/10">
            {FAQS.map((f) => (
              <div key={f.q} className="py-8 first:pt-0">
                <dt className="text-lg font-semibold text-marketing-navy-950">
                  {f.q}
                </dt>
                <dd className="mt-3 text-base leading-relaxed text-marketing-navy-900/70">
                  {f.a}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Section>

      {/* 3 — Final CTA */}
      <Section tone="navy" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow tone="dark">Still have questions?</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Talk it through with the team directly.
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/contact">
                Book a Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline-on-dark">
              <Link href="/pricing">See Pricing</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
