import type { Metadata } from "next";
import Link from "next/link";
import { ListOrdered, TrendingUp, MessageSquareText, LayoutDashboard, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";

const TITLE = "Student Performance Appraisal & Merit Lists for Kenyan Schools — EduCore";
const DESCRIPTION = "Why merit lists usually mean rebuilding a spreadsheet from scratch, and how EduCore computes rankings and growth trends automatically.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog/student-performance-appraisal-kenya-schools" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/blog/student-performance-appraisal-kenya-schools", images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

// Every EduCore capability below verified against the codebase before writing, same sources as
// /student-performance-appraisal:
//   - Merit lists: supabase/migrations/20260730151614_exams_rankings_and_close.sql -- snapshot at
//     close_exam(), numeric-scale only, cleared and regenerated on reopen.
//   - Growth trend: lib/academics/growth-trend.ts -- classifyTrend(), stable threshold 5, 2+ points
//     required or insufficient_data.
//   - Remark bank: (app)/exams/remark-bank-actions.ts -- REMARK_BANK_CATEGORIES.
//   - Performance dashboard: (app)/exams/performance-dashboard-actions.ts + page.tsx -- Owner/
//     Principal only (ai.read), achievement/competency distributions, growth stats, interventions.
//   - Existing /student-performance-appraisal and /cbc-school-management landing-page claims
//     cross-checked for consistency, not duplicated wholesale.

const FAQS = [
  {
    q: "If a teacher corrects a mark after the exam closes, does the merit list update right away?",
    a: "No. Rankings are computed once when an exam is closed and kept as a snapshot, so a correction afterward doesn't silently reshuffle a rank someone has already seen. To get an updated merit list, the exam is reopened -- which clears the old rankings -- and closed again to regenerate them.",
  },
  {
    q: "Can CBC-graded classes get a merit list too?",
    a: "No, and that's deliberate rather than a missing feature. A CBC competency scale has no single averageable number the way a numeric mark does, so ranking doesn't apply to those classes. It reflects the grading model a school actually chose for that grade, not a gap in the system.",
  },
  {
    q: "How is a student's growth trend calculated -- is it a predictive model?",
    a: "No trained model. A subject's growth is classified by comparing the first and last recorded results in a student's whole history for that subject: more than 5 points up reads as improving, more than 5 down as declining, and anything in between as stable. It only ever runs once there are at least two results -- with fewer, it's marked insufficient data rather than guessed.",
  },
  {
    q: "Where do report-card comments in the remark bank come from?",
    a: "Two sources: a shared library covering categories like Strength, Progress, Needs Support, and the seven CBC core competencies, plus whatever a school has authored itself. A teacher searches and adapts a line rather than writing every comment from nothing.",
  },
  {
    q: "Who can see the class-wide performance dashboard?",
    a: "School Owners and Principals -- it's gated on the same permission as the AI-driven at-risk student list. It shows achievement and competency-development distributions, growth stats, and a rule-based list of students flagged for intervention, for one exam and class at a time.",
  },
  {
    q: "Does a report card still show class rank, or has EduCore removed it entirely?",
    a: "It still shows, but as a secondary detail -- schools that want it still have it. What leads the report card instead is an achievement distribution and a Strengths/Areas for Support summary, following CBC/CBE's own shift away from treating class position as the main measure of a learner.",
  },
];

export default function StudentPerformanceAppraisalKenyaPost() {
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
          { name: "Student Performance Appraisal", path: "/blog/student-performance-appraisal-kenya-schools" },
        ]}
      />
      <ArticleJsonLd
        headline={TITLE}
        description={DESCRIPTION}
        path="/blog/student-performance-appraisal-kenya-schools"
        datePublished="2026-09-14"
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Student Performance Appraisal & Merit Lists for Kenyan Schools
        </h1>
        <BlogByline publishedOn="2026-09-14" />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Marks are usually the easy part -- a teacher enters them exam by
          exam. What eats the rest of a Deputy Principal&apos;s week is
          everything downstream of that: ranking a stream by hand in a
          spreadsheet, remembering which students slipped this term, and
          writing dozens of report-card comments from scratch. Here&apos;s
          where that breaks down, and how EduCore builds it from the marks
          that already exist.
        </p>
      </Section>

      {/* 2 — Where the manual process breaks down */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Real Cost</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Where the merit list falls apart
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              A typical end of exam: marks land in one spreadsheet per
              subject, someone pastes them all into a master sheet, sorts
              by average, and manually types a rank next to each name --
              for every stream, every class, every term. If a mark gets
              corrected afterward, that whole sheet either gets silently
              redone or, more often, quietly left wrong.
            </p>
            <p>
              Growth over time is worse. Knowing that a student has been
              slipping in Mathematics for two terms running usually
              depends on a teacher remembering it, not on anything the
              school actually tracks -- and the report-card comment for
              that student is written from scratch, under time pressure,
              alongside forty others.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — Core: EduCore's capabilities */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">Where EduCore Fits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Built from the marks already entered, not a second process
          </h2>
        </Reveal>

        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
          <Reveal>
            <ListOrdered className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">A merit list the moment an exam closes</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Rank in stream and rank in class, computed automatically as
              soon as a numeric exam is closed -- a snapshot, so a later
              correction can&apos;t silently reshuffle a rank someone has
              already seen.
            </p>
          </Reveal>
          <Reveal>
            <TrendingUp className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Growth tracked without a spreadsheet</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Every subject with two or more recorded results gets
              classified as improving, declining, or stable across a
              student&apos;s whole history -- deterministically, never a
              guess when there isn&apos;t enough data yet.
            </p>
          </Reveal>
          <Reveal>
            <MessageSquareText className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Report-card comments, picked not composed</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              A categorized remark bank -- strengths, progress,
              needs-support, and the seven CBC core competencies -- pulls
              from a shared library plus whatever a school has written
              itself.
            </p>
          </Reveal>
          <Reveal>
            <LayoutDashboard className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">One dashboard for the whole class</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Achievement and competency-development distributions, growth
              stats, and a rule-based list of students flagged for
              intervention -- one screen, for Owners and Principals.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* 4 — What doesn't get automated / stays deliberate */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>What Stays Deliberate, On Purpose</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            No rank where there&apos;s no number to rank by. No trend from too little data.
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              CBC-graded classes don&apos;t get a merit list -- a
              competency scale has no single averageable number, so
              ranking simply doesn&apos;t apply there, by design. A growth
              trend is never shown off a single result either; with fewer
              than two data points it&apos;s marked insufficient rather
              than guessed into a misleading direction.
            </p>
            <p>
              And the report card itself leads with an achievement
              distribution and Strengths/Areas for Support, not a raw
              class-position number, in line with CBC/CBE&apos;s own shift
              away from making rank the headline measure of a learner. It
              still shows -- just secondary, for schools that want it.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 5 — Product page link */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-base leading-relaxed text-white/75">
            This is EduCore&apos;s{" "}
            <Link href="/student-performance-appraisal" className="font-semibold text-marketing-gold-400 underline underline-offset-4">
              Performance Appraisal Engine
            </Link>{" "}
            -- merit lists, structured CBC rubrics, growth trends, and a
            class dashboard, all built from the same marks a teacher
            already enters.
          </p>
        </Reveal>
      </Section>

      {/* 6 — FAQ */}
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
                <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">{f.a}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </Section>

      {/* 7 — Final CTA */}
      <Section tone="navy" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow tone="dark">Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            See a merit list and growth trend built from your own exam data.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            A demo runs on a real exam and class, not a canned example.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/contact">
                Book a Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/student-performance-appraisal">Explore Performance Appraisal</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
