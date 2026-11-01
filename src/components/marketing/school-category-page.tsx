import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { ModuleBlock } from "@/components/marketing/module-block";
import { DashboardFrame } from "@/components/marketing/dashboard-frame";
import { SchoolCategoryPreview } from "@/components/marketing/school-category-preview";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { PUBLISHED_PRICE_KES_PER_STUDENT_TERM } from "@/lib/growth/product-facts";
import { TRIAL_CTA_LABEL, TRIAL_HREF, TRIAL_TERMS } from "@/lib/marketing/trial";
import { getSchoolCategory, type SchoolCategory } from "@/lib/marketing/school-categories";

// Shared layout for every /schools/[category] page. All copy comes from
// src/lib/marketing/school-categories.ts; this file only decides structure.
//
// Conversion links are deliberately the plain, existing ones: "/contact" (the
// demo form) and TRIAL_HREF ("/signup"). Nothing new is created for enquiries or
// sign-ups. The existing delegated click tracker (analytics.tsx) already records
// any /contact or /signup click with cta_location = this page's path, and keeps
// it for the demo form's GA4 events, so the visitor's school category travels
// into the existing flows with no query strings, tables or schema changes.
//
// Section tones alternate canvas/navy (Section's own rule: never two dark
// sections in a row).

const DEMO_CTA_LABEL = "Book a Free Demo";

export function SchoolCategoryPage({ category }: { category: SchoolCategory }) {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: category.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const related = category.related
    .map((slug) => getSchoolCategory(slug))
    .filter((c): c is SchoolCategory => Boolean(c));

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: category.navLabel, path: `/schools/${category.slug}` }]} />

      {/* 1. Hero */}
      <Section tone="navy" className="pb-14 pt-16 sm:pb-20 sm:pt-20">
        <div className="max-w-3xl">
          <Eyebrow tone="light">{category.eyebrow}</Eyebrow>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">{category.h1}</h1>
          <p className="mt-6 max-w-2xl text-lg text-white/70">{category.heroLead}</p>
          <ul className="mt-6 flex flex-wrap gap-2" aria-label="Who this is for">
            {category.audience.map((a) => (
              <li
                key={a}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80"
              >
                {a}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap items-center gap-3 sm:gap-4">
            <MarketingButton size="lg" asChild>
              <Link href="/contact">
                {DEMO_CTA_LABEL} <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton size="lg" variant="outline-on-dark" asChild>
              <Link href={TRIAL_HREF}>{TRIAL_CTA_LABEL}</Link>
            </MarketingButton>
          </div>
          <p className="mt-3 text-sm font-medium text-white/70">
            We aim to reply to demo requests within two hours. {TRIAL_TERMS}
          </p>
        </div>
        <div className="mt-12 sm:mt-14" role="img" aria-label={category.heroAlt}>
          <DashboardFrame />
          <p className="mt-3 text-center text-xs text-white/50">Illustrative preview — not actual account data.</p>
        </div>
      </Section>

      {/* 2. School-specific challenges */}
      <Section tone="canvas">
        <Reveal>
          <Eyebrow tone="dark">The Challenges</Eyebrow>
          <h2 className="mt-4 max-w-2xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            What gets in the way for {category.navLabel.toLowerCase()}.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {category.challenges.map((c, i) => (
            <Reveal key={c.title} delayMs={i * 40}>
              <div className="h-full rounded-2xl border border-marketing-navy-900/10 bg-white p-6">
                <h3 className="text-lg font-semibold text-marketing-navy-950">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">{c.problem}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 3. How EduCore helps */}
      <Section tone="navy">
        <div className="grid gap-10 lg:grid-cols-[1fr_340px] lg:items-start">
          <div>
            <Reveal>
              <Eyebrow tone="light">How EduCore Helps</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
                {category.coreMessage}
              </h2>
            </Reveal>
            <ul className="mt-8 flex flex-col gap-5">
              {category.challenges.map((c, i) => (
                <Reveal key={c.title} delayMs={i * 40}>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-marketing-gold-500/15 text-marketing-gold-400">
                      <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-base font-semibold text-white">{c.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-white/65">{c.help}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
          <Reveal delayMs={150} className="hidden lg:block">
            <SchoolCategoryPreview kind={category.preview} />
            <p className="mt-3 text-center text-xs text-white/50">Illustrative preview — not actual account data.</p>
          </Reveal>
        </div>
      </Section>

      {/* 4. Relevant modules */}
      <Section tone="canvas">
        <Reveal>
          <Eyebrow tone="dark">The Modules</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            The parts of EduCore that matter most to your school.
          </h2>
          <p className="mt-4 max-w-xl text-marketing-navy-900/70">
            Every module below exists in the platform today. See the{" "}
            <Link href="/platform" className="text-marketing-blue underline underline-offset-2">
              full platform
            </Link>{" "}
            for everything else.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {category.modules.map((m, i) => (
            <Reveal key={m.title} delayMs={i * 40}>
              <ModuleBlock
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

      {/* 5. Benefits */}
      <Section tone="navy">
        <Reveal>
          <Eyebrow tone="light">The Benefits</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            What changes, for each person who uses it.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {category.benefits.map((b, i) => (
            <Reveal key={b.audience} delayMs={i * 40}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <b.icon className="h-5 w-5 text-marketing-gold-400" strokeWidth={1.75} aria-hidden="true" />
                <h3 className="mt-4 text-base font-semibold text-white">{b.audience}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/65">{b.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 6. How it works */}
      <Section tone="canvas">
        <Reveal>
          <Eyebrow tone="dark">How It Works</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Getting started.
          </h2>
        </Reveal>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {category.steps.map((s, i) => (
            <Reveal key={s.title} delayMs={i * 40}>
              <li className="h-full list-none rounded-2xl border border-marketing-navy-900/10 bg-white p-6">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-marketing-blue/10 text-sm font-semibold text-marketing-blue">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-base font-semibold text-marketing-navy-950">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">{s.description}</p>
              </li>
            </Reveal>
          ))}
        </ol>
        <p className="mt-6 text-sm text-marketing-navy-900/70">
          Would rather see it first?{" "}
          <Link href="/contact" className="font-medium text-marketing-blue underline underline-offset-2">
            Book a demo
          </Link>{" "}
          and we&apos;ll walk through it with you.
        </p>
      </Section>

      {/* 7. Pricing: reuses the published rate and the single trial-terms source */}
      <Section tone="navy">
        <Reveal className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <Eyebrow tone="light">Pricing</Eyebrow>
            <h2 className="mt-4 max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
              From KES {PUBLISHED_PRICE_KES_PER_STUDENT_TERM} per student, per term.
            </h2>
            <p className="mt-4 max-w-2xl text-white/70">
              {TRIAL_TERMS} Which modules are included depends on your plan, and an exact quote for your school comes
              from a short conversation with the team. The{" "}
              <Link href="/pricing" className="text-marketing-gold-300 underline underline-offset-2 hover:text-marketing-gold-400">
                Pricing page
              </Link>{" "}
              has the full breakdown.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <MarketingButton size="lg" asChild>
              <Link href={TRIAL_HREF}>{TRIAL_CTA_LABEL}</Link>
            </MarketingButton>
            <MarketingButton size="lg" variant="outline-on-dark" asChild>
              <Link href="/pricing">See pricing</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>

      {/* 8. FAQ: a visible list whose text matches the FAQPage JSON-LD above */}
      <Section tone="canvas">
        <Reveal>
          <Eyebrow tone="dark">Questions</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Frequently asked questions.
          </h2>
        </Reveal>
        <dl className="mt-10 grid gap-4 lg:grid-cols-2">
          {category.faqs.map((f) => (
            <div key={f.q} className="rounded-2xl border border-marketing-navy-900/10 bg-white p-6">
              <dt className="text-base font-semibold text-marketing-navy-950">{f.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">{f.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-sm text-marketing-navy-900/70">
          More questions? See the{" "}
          <Link href="/faq" className="font-medium text-marketing-blue underline underline-offset-2">
            full FAQ
          </Link>{" "}
          or{" "}
          <Link href="/contact" className="font-medium text-marketing-blue underline underline-offset-2">
            contact us
          </Link>
          .
        </p>
      </Section>

      {/* 9. Final conversion */}
      <Section tone="navy">
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <Eyebrow tone="light">Get Started</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            See EduCore with your school&rsquo;s own setup, or start a trial today.
          </h2>
          <p className="max-w-xl text-white/70">
            <ShieldCheck className="mr-1 inline h-4 w-4 -translate-y-0.5" strokeWidth={1.75} aria-hidden="true" />
            {TRIAL_TERMS}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            <MarketingButton size="lg" asChild>
              <Link href="/contact">
                {DEMO_CTA_LABEL} <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton size="lg" variant="outline-on-dark" asChild>
              <Link href={TRIAL_HREF}>{TRIAL_CTA_LABEL}</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>

      {/* Internal links to the other school types and the shared feature pages */}
      <Section tone="canvas" className="border-t border-marketing-navy-900/10 py-14 sm:py-16">
        <h2 className="text-lg font-semibold text-marketing-navy-950">Other school types</h2>
        <ul className="mt-4 flex flex-wrap gap-3">
          {related.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/schools/${c.slug}`}
                className="inline-flex rounded-full border border-marketing-navy-900/15 px-4 py-2 text-sm font-medium text-marketing-navy-900 hover:bg-marketing-navy-900/5"
              >
                {c.navLabel}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/solutions"
              className="inline-flex rounded-full border border-marketing-navy-900/15 px-4 py-2 text-sm font-medium text-marketing-navy-900 hover:bg-marketing-navy-900/5"
            >
              All solutions
            </Link>
          </li>
        </ul>
        <p className="mt-6 text-sm text-marketing-navy-900/70">
          Related guides:{" "}
          <Link href="/cbc-school-management" className="text-marketing-blue underline underline-offset-2">
            CBC school management
          </Link>
          ,{" "}
          <Link href="/finance-fees" className="text-marketing-blue underline underline-offset-2">
            fees and M-Pesa
          </Link>
          ,{" "}
          <Link href="/school-attendance-management" className="text-marketing-blue underline underline-offset-2">
            attendance
          </Link>{" "}
          and{" "}
          <Link href="/parent-communication" className="text-marketing-blue underline underline-offset-2">
            parent communication
          </Link>
          .
        </p>
      </Section>
    </>
  );
}
