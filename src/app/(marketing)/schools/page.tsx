import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import { SCHOOL_CATEGORIES } from "@/lib/marketing/school-categories";
import { TRIAL_CTA_LABEL, TRIAL_HREF, TRIAL_TERMS } from "@/lib/marketing/trial";

// Hub for the five /schools/<category> landing pages. It exists so /schools is a real page rather
// than a 404 (the category breadcrumbs point here), and so the five pages are linked from one
// crawlable place. Cards are generated from SCHOOL_CATEGORIES, so a category added there appears
// here, in the sitemap and in the demo form's school-type options (a test keeps those in step).

const TITLE = "School Management Software by School Type in Kenya | EduCore";
const DESCRIPTION =
  "School management software for nursery, primary, junior, secondary and integrated schools in Kenya. Find your school type and try EduCore free for 30 days.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/schools" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/schools", images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

export default function SchoolsHubPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "School types", path: "/schools" }]} />

      <Section tone="navy" className="pb-14 pt-16 sm:pb-20 sm:pt-20">
        <div className="max-w-3xl">
          <Eyebrow tone="light">By School Type</Eyebrow>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            School management software that fits the kind of school you run.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/70">
            A nursery, a primary school and a secondary school with boarding don&apos;t need the same things from a school
            system. Pick your school type to see the parts of EduCore that matter most to you.
          </p>
        </div>
      </Section>

      <Section tone="canvas">
        <Reveal>
          <Eyebrow tone="dark">Choose Your School Type</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Five ways schools use EduCore.
          </h2>
        </Reveal>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SCHOOL_CATEGORIES.map((c, i) => (
            <Reveal key={c.slug} delayMs={i * 40}>
              <li className="h-full list-none">
                <Link
                  href={`/schools/${c.slug}`}
                  className="group flex h-full flex-col rounded-2xl border border-marketing-navy-900/10 bg-white p-6 transition-colors hover:border-marketing-blue/40"
                >
                  <h3 className="text-lg font-semibold text-marketing-navy-950">{c.navLabel}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-marketing-navy-900/70">{c.summary}</p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-marketing-blue">
                    See how EduCore fits{" "}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            </Reveal>
          ))}
        </ul>
      </Section>

      <Section tone="navy">
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <Eyebrow tone="light">Not Sure Which Fits?</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            Tell us about your school and we&rsquo;ll show you.
          </h2>
          <p className="max-w-xl text-white/70">{TRIAL_TERMS}</p>
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            <MarketingButton size="lg" asChild>
              <Link href="/contact">
                Book a Free Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton size="lg" variant="outline-on-dark" asChild>
              <Link href={TRIAL_HREF}>{TRIAL_CTA_LABEL}</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
