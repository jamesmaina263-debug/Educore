import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Users, Repeat, MessageCircleQuestion } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { PricingCard } from "@/components/marketing/pricing-card";

const TITLE = "Pricing — EduCore";
const DESCRIPTION =
  "EduCore's three plans — Starter, Growth, and Enterprise — scale by student count and module coverage. Termly, per-student billing. Talk to us for a quote sized to your school.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/pricing" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/pricing" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Tier names, student caps, module coverage, and billing cadence below are
// pulled from the real, active subscription_plans table (already used for
// live school billing) -- not invented. Exact per-student KES rates are
// deliberately left off this public page per owner decision; the "Talk to
// us" price slot in PricingCard is where a real number could go later
// without a redesign.
const PLANS = [
  {
    name: "Starter",
    tagline: "For small schools getting started with EduCore.",
    studentCap: "Up to 200 students",
    billingNote: "Termly",
    features: [
      "Core student & staff records",
      "Academics",
      "Finance & Fees",
    ],
    ctaLabel: "Talk to Sales",
  },
  {
    name: "Growth",
    tagline: "For established schools needing the full feature set.",
    studentCap: "Up to 800 students",
    billingNote: "Termly",
    features: [
      "Everything in Starter",
      "Payroll",
      "Library",
      "Transport",
      "Boarding",
      "Inventory & Procurement",
      "Communication",
    ],
    ctaLabel: "Talk to Sales",
  },
  {
    name: "Enterprise",
    tagline: "For large schools and school groups, including AI features.",
    studentCap: "No student cap",
    billingNote: "Termly",
    features: [
      "Everything in Growth",
      "Full platform module set",
      "Educore AI features",
    ],
    ctaLabel: "Talk to Sales",
  },
];

export default function PricingPage() {
  return (
    <>
      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Pricing</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Three plans. Scaled to how many students you actually have.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          EduCore is priced per enrolled student and billed each school term
          — not a flat platform fee you pay whether you use it or not. A
          quote sized to your school takes one conversation.
        </p>
      </Section>

      {/* 2 — Plan cards */}
      <Section tone="canvas">
        <Reveal>
          <div className="grid gap-6 lg:grid-cols-3">
            {PLANS.map((plan) => (
              <PricingCard
                key={plan.name}
                name={plan.name}
                tagline={plan.tagline}
                studentCap={plan.studentCap}
                billingNote={plan.billingNote}
                features={plan.features}
                ctaLabel={plan.ctaLabel}
                ctaHref="/contact"
              />
            ))}
          </div>
        </Reveal>
      </Section>

      {/* 3 — How pricing works */}
      <Section tone="navy">
        <Reveal>
          <Eyebrow tone="dark">How pricing works</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Straightforward, and matched to how schools already budget.
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            <div>
              <Users className="h-5 w-5 text-marketing-gold-400" strokeWidth={1.75} />
              <p className="mt-3 text-sm font-semibold text-white">
                Priced per enrolled student
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                You&apos;re quoted against the students you actually have —
                not a flat seat count or a guess at your school&apos;s size.
              </p>
            </div>
            <div>
              <Repeat className="h-5 w-5 text-marketing-gold-400" strokeWidth={1.75} />
              <p className="mt-3 text-sm font-semibold text-white">
                Billed by the term
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                Invoicing follows the school calendar your finance team
                already plans around, not a monthly subscription cycle.
              </p>
            </div>
            <div>
              <MessageCircleQuestion className="h-5 w-5 text-marketing-gold-400" strokeWidth={1.75} />
              <p className="mt-3 text-sm font-semibold text-white">
                Your exact quote comes from a conversation
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                Student count and the modules your school needs both shape
                the number — we&apos;ll work that out with you directly.
              </p>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* 4 — Final CTA */}
      <Section tone="canvas" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow>Get a quote</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Tell us about your school, get a number back.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
            A short conversation is all it takes to size a plan to your
            student count and the modules you need.
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
