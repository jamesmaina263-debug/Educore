import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Users, Repeat, MessageCircleQuestion } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { PricingCard } from "@/components/marketing/pricing-card";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "School Management System Pricing Kenya — EduCore";
const DESCRIPTION =
  "EduCore pricing starts at KES 100 per student, per term, the same flat rate across all three plans — Starter, Growth, and Enterprise — which scale by module coverage, not price.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/pricing" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/pricing" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Tier names, student caps, module coverage, and billing cadence below are
// pulled from the real, active subscription_plans table (already used for
// live school billing) -- not invented. Real pricing (Sep 2026): a flat
// KES 100 per student, per term, across all three tiers -- tiers differ by
// module coverage and support, not price. Published with a "starting at"
// qualifier rather than an absolute figure so the page stays accurate if
// the rate is revisited later.
const PRICE_LINE = "From KES 100";
const PRICE_NOTE = "/ student / term";

export const PLANS = [
  {
    name: "Starter",
    tagline: "For small schools getting started with EduCore.",
    studentCap: "Up to 200 students",
    billingNote: "Termly",
    priceLine: PRICE_LINE,
    priceNote: PRICE_NOTE,
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
    priceLine: PRICE_LINE,
    priceNote: PRICE_NOTE,
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
    priceLine: PRICE_LINE,
    priceNote: PRICE_NOTE,
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
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Pricing", path: "/pricing" }]} />
      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Pricing</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Three plans. Scaled to how many students you actually have.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Simple pricing, starting at KES 100 per student, per term. Every
          plan — Starter, Growth, and Enterprise — starts at that same flat
          rate; they scale by module coverage and support, not price.
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
                priceLine={plan.priceLine}
                priceNote={plan.priceNote}
                features={plan.features}
                ctaLabel={plan.ctaLabel}
                ctaHref="/contact"
                ctaTier={plan.name}
              />
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-marketing-navy-900/60">
            Example: a 150-student school pays from about KES 15,000 per
            term, regardless of plan.
          </p>
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
                We confirm the exact figure together
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                The base rate is fixed at KES 100 per student, per term —
                we&apos;ll confirm your final number and any add-ons in one
                conversation.
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
