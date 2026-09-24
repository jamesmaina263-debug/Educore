import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, BarChart3, ShieldCheck, History, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";

const TITLE = "Teacher Performance Reviews for Kenyan Schools: Termly, Structured, and Kept Private — EduCore";
const DESCRIPTION =
  "Why teacher appraisal usually lives in a locked cabinet or a Principal's private notebook, and how EduCore keeps it structured instead — 1-5 competency scoring, an automatically computed rating, and visibility locked to the reviewer tier and the teacher being reviewed.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog/teacher-performance-reviews-kenya-schools" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/blog/teacher-performance-reviews-kenya-schools", images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

// Every EduCore capability below independently verified against the codebase before writing --
// same sources /teacher-performance-management already cites, re-checked rather than copied:
//   - Schema, RLS, trigger: supabase/migrations/20260731182545_teacher_performance_reviews.sql --
//     competency_scores jsonb, overall_rating computed by compute_review_overall_rating() trigger
//     (avg of numeric jsonb values), no delete policy (update only), select policy is
//     read_any-for-reviewer-tier OR self.
//   - Default competencies: components/performance/performance-section.tsx --
//     DEFAULT_COMPETENCIES = ["Classroom management", "Subject knowledge", "Punctuality",
//     "Collaboration"]. No "add competency" control in the UI today, even though the jsonb column
//     doesn't hard-code the set -- stated as current UI state, not a permanent design choice.
//   - Validation: lib/performance/review-input.ts -- MIN/MAX 1-5, a review needs at least one score
//     or a note. Comment in that file documents the bug this closed: the number inputs aren't
//     inside a <form>, so the browser never enforced their min/max, and the DB trigger silently
//     drops non-numeric/out-of-range values from the average rather than rejecting them -- so an
//     unvalidated 9 could previously save as a nonsense "Overall: 9/5".
//   - Reviewable roles: (app)/performance/page.tsx -- staff options are drawn from roles teacher,
//     class_teacher, deputy_principal (i.e. a Deputy Principal can be reviewed too, presumably by
//     the Principal/Owner tier above them).
//   - No notification on save: grepped for any notification hook tied to
//     teacher_performance_reviews -- none exists. A teacher finds a new review by opening their own
//     record (RLS grants them read access), not via a push/email alert. Stated as-is, not implied.
//   - Existing /teacher-performance-management landing-page claims cross-checked for consistency,
//     not duplicated wholesale.

const FAQS = [
  {
    q: "Can a school track competencies beyond the default four?",
    a: "The data model doesn't hard-code them -- competency scores are stored as flexible key/value pairs precisely so a school's categories could evolve without a database change. But the review form itself only offers the four defaults (classroom management, subject knowledge, punctuality, collaboration) today; there's no \"add a competency\" control in the interface yet.",
  },
  {
    q: "If a reviewer enters a score by mistake, can the review be deleted?",
    a: "No -- a review can be corrected via an update, but there's no delete option. That's deliberate, the same precedent EduCore applies to its audit log: a performance review is a historical record, and the fact that one existed at a point in time is never silently erased, even if its content gets revised afterward.",
  },
  {
    q: "Is the overall rating something a reviewer types in?",
    a: "No. A reviewer only scores individual competencies from 1 to 5. The overall rating is computed by a database trigger as the average of whatever numeric scores were entered, the moment the review is saved -- there's no separate field for it, so it can't drift out of sync with the competency scores behind it.",
  },
  {
    q: "Does a teacher get notified when a review about them is saved?",
    a: "Not automatically -- there's no notification or email tied to saving a review. A teacher sees it by opening their own performance record, which their account has read access to under the same rule that keeps everyone else out: visible to the reviewer tier and to the person being reviewed, nobody else.",
  },
  {
    q: "Can a Deputy Principal be reviewed too, or only classroom teachers?",
    a: "Deputy Principals are reviewable, alongside teachers and class teachers -- the reviewable-staff list isn't limited to the classroom. A Deputy Principal's review would typically come from the Principal or School Owner tier above them.",
  },
  {
    q: "What actually stopped a score of 9 or -3 from being saved?",
    a: "A real gap that got fixed, not a hypothetical: the score inputs on the review form aren't inside an HTML <form>, so the browser's own min/max validation never ran, and the database's rating trigger just quietly drops anything non-numeric or out of range from its average rather than rejecting the row. A validation step now checks every score is a finite number between 1 and 5 before a review can save at all.",
  },
];

export default function TeacherPerformanceReviewsKenyaPost() {
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
          { name: "Teacher Performance Reviews", path: "/blog/teacher-performance-reviews-kenya-schools" },
        ]}
      />
      <ArticleJsonLd
        headline={TITLE}
        description={DESCRIPTION}
        path="/blog/teacher-performance-reviews-kenya-schools"
        datePublished="2026-09-21"
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Teacher Performance Reviews for Kenyan Schools
        </h1>
        <BlogByline publishedOn="2026-09-21" />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Student performance gets a merit list, a growth trend, a
          dashboard. Teacher performance, at most schools, gets a Principal&apos;s
          private notebook or a paper form filed once a term and rarely
          looked at again. Here&apos;s what that costs a school, and how
          EduCore keeps the record instead -- structured, private to the
          people it actually concerns, and never an algorithm&apos;s score.
        </p>
      </Section>

      {/* 2 — Where the informal process breaks down */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Real Cost</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Where an informal review falls apart
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              A Deputy Principal sits in on a lesson, forms a judgment, and
              writes it down somewhere -- a notebook, a loose form, a memory
              they intend to act on later. Six months on, at the next TSC
              appraisal cycle or a difficult conversation about a
              teacher&apos;s classroom management, that judgment either
              isn&apos;t written down anywhere retrievable, or it&apos;s one
              sheet of paper in a file cabinet that only shows the most
              recent review, not the pattern across a full year.
            </p>
            <p>
              The other failure mode is the opposite problem: a review that
              is too visible. A performance note meant for a Principal and a
              teacher ends up readable by whoever has access to the shared
              drive it was saved on, which makes reviewers softer on paper
              than they&apos;d be in the room -- exactly the outcome a
              private, structured record is supposed to prevent.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — Core: EduCore's capabilities */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">Where EduCore Fits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            A record built for judgment, not an algorithm
          </h2>
        </Reveal>

        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
          <Reveal>
            <CalendarClock className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Termly and annual, in one history</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              A review is either tied to the current term or stands alone as
              an annual review -- both live in the same record for a
              teacher, not two separate processes to keep in sync.
            </p>
          </Reveal>
          <Reveal>
            <BarChart3 className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Scored, not summarized from memory</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Classroom management, subject knowledge, punctuality, and
              collaboration, each scored 1 to 5. The overall rating is
              computed automatically as their average the moment a review
              is saved -- never a separate number a reviewer has to keep
              consistent by hand.
            </p>
          </Reveal>
          <Reveal>
            <ShieldCheck className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Visible to two people, on purpose</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              The reviewer tier -- Principal, Deputy Principal, School
              Owner -- and the teacher the review is about. Nobody else in
              the school can open it, enforced the same way as every other
              record in EduCore: at the database, not just hidden in the
              interface.
            </p>
          </Reveal>
          <Reveal>
            <History className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">A history, not a single sheet</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Every review a teacher has ever received stays on file,
              newest first -- a pattern across terms and years, not just
              whatever was filled in most recently.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* 4 — What doesn't get automated / stays deliberate */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>What Stays Deliberate, On Purpose</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            No AI score. No deleting a review that turned out inconvenient.
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              A teacher performance review is deliberately kept out of
              EduCore&apos;s AI Assistant entirely. It&apos;s a Principal&apos;s
              or Deputy&apos;s own assessment of what they observed, not a
              score generated on their behalf -- the same distinction the
              system draws for a student&apos;s merit list, applied to the
              adults running the classroom instead of the learners in it.
            </p>
            <p>
              And once a review is saved, it can be corrected but not
              deleted -- there is no delete option in the database policy at
              all. If a score was entered wrong, the fix is an update that
              leaves a clear trail, not a quiet removal of the fact that a
              review happened.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 5 — Product page link */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-base leading-relaxed text-white/75">
            This is EduCore&apos;s{" "}
            <Link href="/teacher-performance-management" className="font-semibold text-marketing-gold-400 underline underline-offset-4">
              Teacher Performance Management
            </Link>{" "}
            system -- structured competency scoring, a computed overall
            rating, and a review history kept exactly as private as it
            needs to be.
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
            See a teacher performance review saved, start to finish.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            A demo walks through scoring a review as a Principal or
            Deputy, and what the teacher sees on their own side.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/contact">
                Book a Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/teacher-performance-management">Explore Teacher Performance</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
