import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, BarChart3, ShieldCheck, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { ModuleBlock } from "@/components/marketing/module-block";
import { MiniFrame } from "@/components/marketing/mini-frame";
import { Badge } from "@/components/ui/badge";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "Teacher Performance Management System — EduCore Kenya";
const DESCRIPTION = "Termly and annual teacher reviews with structured 1-5 scoring and an automatic rating, visible only to the reviewer tier and the teacher reviewed.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/teacher-performance-management" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/teacher-performance-management" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Grounded in (app)/performance/page.tsx + actions.ts, components/performance/performance-section.tsx,
// and supabase/migrations/20260731182545_teacher_performance_reviews.sql -- verified by reading all
// four before writing this copy. In particular: overall_rating is computed by a DB trigger as the
// average of whatever numeric competency_scores were entered (not user-entered, not AI-generated);
// competency_scores is jsonb so a school's categories can evolve without a migration, though the
// current form ships four defaults (classroom management, subject knowledge, punctuality,
// collaboration); visibility is hierarchy-only per the table comment ("visible only to the reviewed
// staff member and the reviewer tier above them, never broadly to other staff"); there is no delete
// policy, only update -- a review is a historical record, same precedent as audit_log.
const PERFORMANCE_MODULES = [
  {
    icon: CalendarClock,
    title: "Termly & Annual Reviews",
    audience: "Principals & Deputies",
    description:
      "A review is either termly, tied to the current term, or annual, spanning the whole year — both live in the same history for a teacher, not two separate processes.",
    capabilities: ["Termly reviews tied to the active term", "Annual reviews independent of any term", "Full review history per teacher"],
  },
  {
    icon: BarChart3,
    title: "Structured Competency Scoring",
    audience: "Reviewers",
    description:
      "Each review scores a set of competencies from 1 to 5 — classroom management, subject knowledge, punctuality, and collaboration by default — and the overall rating is computed automatically as their average the moment the review is saved.",
    capabilities: ["1–5 scoring per competency", "Overall rating computed automatically, not entered by hand", "Free-text notes alongside the scores"],
  },
  {
    icon: ShieldCheck,
    title: "Hierarchy-Only Visibility",
    audience: "Everyone in the record",
    description:
      "A review is visible to the reviewer tier — Principal, Deputy Principal, School Owner — and to the teacher it's about. Nobody else in the school sees it, and once saved, a review is corrected, never deleted.",
    capabilities: ["Visible only to reviewer tier + the reviewed teacher", "Permission-gated review creation", "No delete policy — corrected, never erased"],
  },
];

export default function TeacherPerformanceManagementPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Teacher Performance", path: "/teacher-performance-management" }]} />
      <Section tone="navy" className="pt-16 sm:pt-20">
        <Eyebrow tone="light">Teacher Performance</Eyebrow>
        <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
          A teacher performance review your Deputy Principal can trust — and nobody else can see.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-white/70">
          Termly and annual reviews, scored competency by competency, with
          an overall rating the system computes for you. No algorithm
          judges a teacher — this is a human-judgment record, kept
          alongside the academic data it&rsquo;s actually based on.
        </p>
      </Section>

      <Section tone="canvas">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
          <div>
            <Reveal>
              <Eyebrow tone="dark">The Moment It Happens</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
                Score the competencies. The overall rating works itself out.
              </h2>
              <p className="mt-4 max-w-xl text-marketing-navy-900/70">
                A reviewer scores whichever competencies matter for that
                review — classroom management, subject knowledge,
                punctuality, and collaboration by default — on a 1-to-5
                scale. The overall rating isn&rsquo;t a separate field to
                fill in or a spreadsheet formula to keep in sync; it&rsquo;s
                computed automatically as the average the moment the
                review is saved.
              </p>
            </Reveal>
          </div>
          <Reveal delayMs={150} className="hidden lg:block">
            <MiniFrame path="app.educore.io/performance">
              <p className="text-[11px] font-medium text-foreground">Reviews — Term 2</p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-foreground">David Otieno</span>
                    <Badge variant="secondary" className="bg-success-subtle font-mono text-[9px] text-success">
                      Overall: 4.25/5
                    </Badge>
                  </div>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    Classroom management: 4 · Subject knowledge: 5 · Punctuality: 4 · Collaboration: 4
                  </p>
                </div>
                <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-foreground">Faith Njoroge</span>
                    <Badge variant="secondary" className="bg-success-subtle font-mono text-[9px] text-success">
                      Overall: 4.67/5
                    </Badge>
                  </div>
                  <p className="mt-1 text-[9px] text-muted-foreground">Annual · Reviewed by Principal</p>
                </div>
              </div>
            </MiniFrame>
          </Reveal>
        </div>
      </Section>

      <Section tone="navy">
        <Reveal>
          <Eyebrow tone="light">The Modules</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            A record built for judgment, not an algorithm.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PERFORMANCE_MODULES.map((m, i) => (
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
            <p className="text-sm font-semibold text-marketing-navy-950">No AI scoring, on purpose</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/65">
              A teacher performance review is deliberately kept out of{" "}
              <Link href="/ai-automation" className="text-marketing-blue underline underline-offset-2">
                EduCore&rsquo;s AI Assistant
              </Link>{" "}
              entirely — it&rsquo;s a principal&rsquo;s or deputy&rsquo;s own assessment, not a score
              generated for them. It sits on the same{" "}
              <Link href="/platform" className="text-marketing-blue underline underline-offset-2">
                staff record
              </Link>{" "}
              as the rest of a teacher&rsquo;s profile, but stays visible only to the reviewer tier and
              the teacher being reviewed.
            </p>
          </div>
        </Reveal>
      </Section>

      <Section tone="navy">
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <Eyebrow tone="light">Get Started</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            See a teacher performance review saved, start to finish.
          </h2>
          <p className="max-w-xl text-white/70">
            A demo walks through scoring a review as a Principal or
            Deputy, and what a teacher sees on their own side.
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
