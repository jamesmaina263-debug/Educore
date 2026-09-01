import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Target, Compass, Building2 } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "About EduCore — School Management Software Built for Kenya";
const DESCRIPTION =
  "Why EduCore exists: one school management system built for the way Kenyan schools actually run, instead of a patchwork of spreadsheets, WhatsApp groups, and paper registers.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/about" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function AboutPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "About", path: "/about" }]} />
      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">About EduCore</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Schools don&apos;t run on one system. We think their software should.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          A fee spreadsheet here, a WhatsApp group there, an admissions
          notebook somewhere else — most schools hold themselves together
          with tools that were never built to talk to each other. EduCore is
          what we built instead.
        </p>
        <p className="mt-4 text-sm font-medium text-white/50">
          Based in Nairobi, Kenya.
        </p>
      </Section>

      {/* 2 — The problem */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Why we built this</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            The gap isn&apos;t effort. It&apos;s tooling.
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              Running a school in Kenya means holding together admissions,
              academics, fees, staffing, and parent communication at the same
              time — often across more than one campus. The people doing that
              work aren&apos;t short on effort. They&apos;re short on a system
              built for how the work actually happens: fees paid over M-Pesa,
              parents reached over WhatsApp, connectivity that isn&apos;t
              always guaranteed, and grading that has to support both a
              numeric scale and CBC competencies at once.
            </p>
            <p>
              Generic school software built somewhere else tends to bolt these
              things on as afterthoughts, if it supports them at all. We built
              EduCore around them from the start.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — Mission / Vision / Approach */}
      <Section tone="navy">
        <Reveal>
          <div className="grid gap-8 sm:grid-cols-3">
            <div>
              <Target className="h-6 w-6 text-marketing-gold-500" strokeWidth={1.75} />
              <h3 className="mt-4 text-lg font-semibold text-white">
                What we&apos;re here to do
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">
                Give every school — one campus or several — a single system
                that covers the whole operation, instead of a different tool
                for every department.
              </p>
            </div>
            <div>
              <Compass className="h-6 w-6 text-marketing-gold-500" strokeWidth={1.75} />
              <h3 className="mt-4 text-lg font-semibold text-white">
                How we build it
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">
                Every module ships because a real part of running a school
                needed it — not as a feature to check off a list. If it&apos;s
                on our site, it&apos;s in the product.
              </p>
            </div>
            <div>
              <Building2 className="h-6 w-6 text-marketing-gold-500" strokeWidth={1.75} />
              <h3 className="mt-4 text-lg font-semibold text-white">
                Who it&apos;s for
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">
                School owners running one campus or a group of them,
                principals, teachers, finance teams, administrators, and the
                parents and students on the other end of every record.
              </p>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* 4 — Final CTA */}
      <Section tone="canvas" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow>Talk to us</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-marketing-navy-950 sm:text-4xl">
            See whether EduCore fits your school.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
            A short conversation is usually enough to tell.
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
