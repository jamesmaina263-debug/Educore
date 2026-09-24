import type { Metadata } from "next";
import Link from "next/link";
import { ListOrdered, Grid3x3, MessageSquareText, TrendingUp, BarChart3, LayoutDashboard, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { ModuleBlock } from "@/components/marketing/module-block";
import { MiniFrame } from "@/components/marketing/mini-frame";
import { Badge } from "@/components/ui/badge";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "Student Performance Appraisal & Exam Merit Lists — EduCore Kenya";
const DESCRIPTION = "Merit lists and class rankings computed automatically at exam close — structured CBC rubrics, a remark bank, growth trends, and a performance dashboard.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/student-performance-appraisal" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/student-performance-appraisal", images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

// Grounded in the "Performance Appraisal Engine" directive as it actually appears in the codebase,
// verified file by file before writing this copy:
//   - Merit lists / class rankings: supabase/migrations/20260730151614_exams_rankings_and_close.sql
//     -- rank_in_stream/rank_in_class computed once at close_exam() as a snapshot (a later mark
//     correction doesn't silently reshuffle a published rank; reopening the exam clears it),
//     numeric-scale exams only ("a CBC competency scale has no single averageable number... not a
//     gap, a reflection of the grading model actually chosen for that grade").
//   - Structured rubrics: (app)/exams/rubric-actions.ts (Step 7) -- criteria x performance-level
//     grid per curriculum sub-strand, reusing grading_scale_bands rather than a new enum.
//   - Remark bank: (app)/exams/remark-bank-actions.ts (Phase 10) -- REMARK_BANK_CATEGORIES:
//     strength/progress/needs_support + the 7 CBC core competencies + general; global library plus
//     school-authored entries.
//   - Growth analysis: lib/academics/growth-trend.ts (Phase 12) -- classifyTrend() is deliberately a
//     simple first-vs-last comparison, not a regression, "so a school can always explain why a trend
//     was called what it was called"; requires 2+ points or returns insufficient_data, never a guess.
//   - Report card insight: components/exams/report-card-insights-panel.tsx (Phase 14/Step 10) --
//     achievement distribution shown ahead of class rank "deliberately... the directive is explicit
//     that traditional class-position ranking should not be the central performance representation."
//   - Class performance dashboard: (app)/exams/performance-dashboard/page.tsx + -actions.ts (Step 12,
//     "the last item in the directive's own recommended sequence") -- Owner/Principal only (ai.read),
//     achievement + competency-development distributions, growth stats, rule-based intervention list.
const APPRAISAL_MODULES = [
  {
    icon: ListOrdered,
    title: "Class Rankings & Merit Lists",
    audience: "Principals & Academic Heads",
    description:
      "When a numeric exam closes, every student gets a rank in their stream and in their class — computed once, as a snapshot, so a later mark correction doesn't silently reshuffle a rank that's already been published.",
    capabilities: ["Rank in stream & rank in class, per exam", "Computed automatically the moment an exam closes", "Numeric-scale exams only — CBC has no single average to rank, by design"],
  },
  {
    icon: Grid3x3,
    title: "Structured CBC Rubrics",
    audience: "Teachers",
    description:
      "A real criteria-by-performance-level grid for each curriculum sub-strand, scored per learner — not a free-text comment standing in for an actual assessment.",
    capabilities: ["Criteria × performance-level grid, per sub-strand", "Scored per individual learner", "Built on the school's own grading scale bands"],
  },
  {
    icon: MessageSquareText,
    title: "Remark Bank",
    audience: "Teachers",
    description:
      "A categorized library of report-card comment lines — strengths, progress, needs-support, and the seven CBC core competencies — so a comment is picked and adapted, not composed from nothing every time.",
    capabilities: ["Strength / Progress / Needs Support categories", "The 7 CBC core competencies as categories", "A shared library plus each school's own authored entries"],
  },
  {
    icon: TrendingUp,
    title: "Growth Trends",
    audience: "Teachers & Academic Heads",
    description:
      "Any subject a student has two or more recorded results for gets classified as improving, declining, or stable across their whole history — deterministically, so a school can always explain why a trend was called what it was called.",
    capabilities: ["Improving / declining / stable, per subject", "Whole recorded history, not just the latest exam", "Never a guess on thin data — flagged as insufficient instead"],
  },
  {
    icon: BarChart3,
    title: "Report Card Insight",
    audience: "Teachers & Parents",
    description:
      "A report card leads with an achievement distribution and Strengths/Areas for Support. Class rank and average still show — just secondary, in line with CBC/CBE's own move away from making class position the headline number.",
    capabilities: ["Achievement distribution by grade band", "Strengths & Areas for Support, generated with the remark bank", "Class rank/average shown, deliberately secondary"],
  },
  {
    icon: LayoutDashboard,
    title: "Class Performance Dashboard",
    audience: "School Owners & Principals",
    description:
      "One screen per exam and class: achievement and competency-development distributions, class-wide growth stats, and a rule-based list of students flagged for intervention.",
    capabilities: ["Achievement & competency-development distributions", "Class-wide growth stats (improving/declining/stable)", "Rule-based intervention flags, Owner/Principal only"],
  },
];

export default function StudentPerformanceAppraisalPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Performance Appraisal", path: "/student-performance-appraisal" }]} />
      <Section tone="navy" className="pt-16 sm:pt-20">
        <Eyebrow tone="light">Performance Appraisal</Eyebrow>
        <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
          Merit lists, growth trends, and a performance dashboard — built from marks teachers already enter.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-white/70">
          Rankings computed automatically when an exam closes, structured
          CBC rubrics, a remark bank, and a class-wide dashboard for
          leadership — one connected appraisal engine, not a spreadsheet
          rebuilt every term.
        </p>
      </Section>

      <Section tone="canvas">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
          <div>
            <Reveal>
              <Eyebrow tone="dark">The Moment It Happens</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
                Close the exam. The merit list is already there.
              </h2>
              <p className="mt-4 max-w-xl text-marketing-navy-900/70">
                The moment a numeric exam is closed, every student is
                ranked in their stream and in their class off their
                average score — a snapshot, not a live number, so
                correcting a mark afterward doesn&rsquo;t quietly reshuffle
                a rank someone has already seen. For CBC-graded classes,
                there&rsquo;s no single number to rank by, so ranking
                doesn&rsquo;t apply there — by design, not a gap.
              </p>
            </Reveal>
          </div>
          <Reveal delayMs={150} className="hidden lg:block">
            <MiniFrame path="app.educore.io/exams/report-cards">
              <p className="text-[11px] font-medium text-foreground">Grade 7 Blue — Term 2 Exam</p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {[
                  { name: "Amina Wanjiru", detail: "Average 84.2 — Rank 1 in stream" },
                  { name: "Brian Kiptoo", detail: "Average 79.6 — Rank 2 in stream" },
                ].map((row) => (
                  <div key={row.name} className="rounded-md border border-border bg-card px-2.5 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-foreground">{row.name}</span>
                      <Badge variant="secondary" className="bg-success-subtle font-mono text-[9px] text-success">
                        Ranked
                      </Badge>
                    </div>
                    <p className="mt-1 text-[9px] text-muted-foreground">{row.detail}</p>
                  </div>
                ))}
              </div>
            </MiniFrame>
          </Reveal>
        </div>
      </Section>

      <Section tone="navy">
        <Reveal>
          <Eyebrow tone="light">The Modules</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            Six pieces, one connected appraisal record.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {APPRAISAL_MODULES.map((m, i) => (
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
            <p className="text-sm font-semibold text-marketing-navy-950">Built around CBC/CBE, not against it</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/65">
              Kenya&rsquo;s own move under CBC/CBE is away from raw class
              ranking as the headline measure of a learner. This engine
              follows that lead — achievement distribution and
              Strengths/Areas for Support come first on a report card,
              rank stays secondary, and a growth trend is only ever shown
              when there&rsquo;s genuinely enough history to support it.
              Read more in{" "}
              <Link href="/blog/cbc-cbe-assessment-learner-performance-kenya" className="text-marketing-blue underline underline-offset-2">
                our guide to CBC, CBE, and learner performance
              </Link>
              , or see how it sits alongside{" "}
              <Link href="/cbc-school-management" className="text-marketing-blue underline underline-offset-2">
                EduCore&rsquo;s CBC grading
              </Link>
              .
            </p>
          </div>
        </Reveal>
      </Section>

      <Section tone="navy">
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <Eyebrow tone="light">Get Started</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            See a merit list and performance dashboard built from your own exam data.
          </h2>
          <p className="max-w-xl text-white/70">
            A demo runs on a real exam and class, so the ranking, growth
            trends, and dashboard aren&rsquo;t abstractions.
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
