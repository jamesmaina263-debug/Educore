import type { Metadata } from "next";
import Link from "next/link";
import {
  Layers,
  ClipboardCheck,
  ImageIcon,
  Users,
  FileText,
  Sparkles,
  ArrowRight,
} from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";

const TITLE = "CBC/CBE Assessment & Learner Performance in Kenya — EduCore";
const DESCRIPTION =
  "How CBC/CBE competency-based assessment works in Kenya, the roles KICD and KNEC actually play, and how EduCore turns strand-level assessment records into real performance insight for schools.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog/cbc-cbe-assessment-learner-performance-kenya" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/blog/cbc-cbe-assessment-learner-performance-kenya" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Every EduCore capability named below was verified directly against the
// codebase before writing, per the CBC/CBE content brief:
//   - strands/sub-strands, competency_marks, four-level competency bands:
//     supabase/migrations/20260806060917_cbc_curriculum_strands.sql
//   - evidence/portfolio uploads tied to a specific rating:
//     supabase/migrations/20260902203459_competency_evidence_portfolio.sql
//   - teacher-scoped write access + closed-exam lock:
//     same migration, competency_marks RLS + enforce_competency_marks_lock()
//   - report card comment lifecycle (ai -> teacher_approved/teacher_written):
//     supabase/migrations/20260731012231_report_cards.sql
//   - parents see the strand/sub-strand breakdown once released:
//     src/app/portal/page.tsx
//   - Ask EduCore AI competency intents (grounded, template-answered, never
//     free-generated): src/app/(app)/ai/actions.ts,
//     "competency_band_breakdown" / "students_needing_competency_support"
//   - class rankings are numeric-scale only, by explicit design (mirrors
//     KNEC's own move away from ranking under CBC/CBE):
//     supabase/migrations/20260730151614_exams_rankings_and_close.sql
//   - KNEC CBA export is a provisional file for manual upload via KNEC's own
//     cba.knec.ac.ke portal, not a live/official integration (KNEC publishes
//     no public API):
//     supabase/migrations/20260903021210_knec_cba_export.sql
// KICD/KNEC/CBC-CBE facts were researched separately from official KNEC
// publications (knec.ac.ke) and Ministry of Education announcements.

const FAQS = [
  {
    q: "Does EduCore support CBC (or CBE) competency-based assessment?",
    a: "Yes. Teachers record ratings at the sub-strand level — the actual unit of CBC/CBE assessment — using Kenya's four competency levels, alongside standard numeric grading. Both models run side by side and can be set per school, grade, or class.",
  },
  {
    q: "Does EduCore replace KICD or KNEC, or claim any official status with them?",
    a: "No. EduCore is not KICD or KNEC, and doesn't claim certification, approval, or an official integration with either body. It's a digital environment schools use to organise and manage the assessment information that Kenya's competency-based curriculum and assessment framework already require them to collect.",
  },
  {
    q: "Can EduCore help with KNEC's Competency-Based Assessment (CBA) submissions?",
    a: "EduCore can generate a clearly labelled provisional export of a school's competency records, organised by student and sub-strand, ready for a registrar or teacher to submit through KNEC's own CBA portal. KNEC has not published a public API for direct submission, so this is a preparation step, not an automatic upload.",
  },
  {
    q: "How does EduCore help a school identify learners who need support?",
    a: "Ask EduCore AI can summarise how a class's sub-strand ratings are distributed across competency levels for the most recent closed exam, and flag which students have multiple \"Below Expectation\" ratings. For numeric-graded classes, a separate rule-based view also flags students combining low attendance, low exam performance, and overdue fees.",
  },
  {
    q: "Do parents actually see their child's competency ratings?",
    a: "Yes. Once a report card is released, a guardian can see their child's strand and sub-strand breakdown alongside the teacher's comment — not just a single overall grade.",
  },
  {
    q: "Are AI-generated report card comments sent to parents automatically?",
    a: "No. An AI-drafted comment is only ever a starting point. It is never visible to a parent until a teacher reviews it and either approves it or writes their own — the same accountability a fully manual comment would have.",
  },
  {
    q: "Does a school have to choose between CBC/CBE and the old numeric system?",
    a: "No. Both grading models are supported natively and can be set independently per school, grade, or class — useful for schools transitioning grade by grade rather than all at once.",
  },
];

export default function CbcCbeAssessmentLearnerPerformancePost() {
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
          { name: "CBC, CBE and Learner Performance", path: "/blog/cbc-cbe-assessment-learner-performance-kenya" },
        ]}
      />
      <ArticleJsonLd
        headline={TITLE}
        description={DESCRIPTION}
        path="/blog/cbc-cbe-assessment-learner-performance-kenya"
        datePublished="2026-09-03"
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          CBC, CBE and Learner Performance: A Practical Guide for Kenyan Schools
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Kenyan education has moved decisively toward competencies, continuous
          assessment, and evidence of what a learner can actually do — not
          just a mark at the end of term. That shift generates far more
          information than the old system ever did. The real advantage
          belongs to schools that can organise it, understand it, and act on
          it. Here&apos;s how CBC/CBE assessment actually works, where KICD
          and KNEC fit in, and how EduCore helps schools turn that
          information into decisions.
        </p>
      </Section>

      {/* 2 — What is CBC/CBE */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Shift</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            What is CBC, and how is it changing school assessment?
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              Kenya&apos;s Competency-Based Curriculum (CBC) replaced the old
              8-4-4 system, shifting the goal of schooling from covering a
              fixed list of content to developing specific, demonstrable
              competencies. In 2025, the Ministry of Education rebranded CBC
              as Competency-Based Education (CBE) — a broader label covering
              not just the curriculum itself but the training, infrastructure,
              and systems that support it. For day-to-day school work, the
              two terms describe the same underlying approach.
            </p>
            <p>
              Every learning area under CBC/CBE is organised by the Kenya
              Institute of Curriculum Development (KICD) into <strong>strands</strong> —
              broad domains within a subject — and each strand into{" "}
              <strong>sub-strands</strong>, the specific, teachable units a
              lesson is actually planned around. A sub-strand is where
              assessment happens: rather than one overall mark per subject,
              a learner&apos;s competency is rated sub-strand by sub-strand,
              building a much more granular picture of where they stand.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — From CBC to CBE: why assessment matters */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Why It Matters</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            From CBC to CBE: why assessment is central, not incidental
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              Under the old system, a single percentage told you very little
              about what a learner could actually do. CBC/CBE assessment is
              deliberately different: it combines ongoing formative
              assessment throughout the term with structured school-based and
              national assessment, and reports achievement using four
              qualitative competency levels — Exceeding Expectation, Meeting
              Expectation, Approaching Expectation, and Below Expectation —
              rather than a single number.
            </p>
            <p>
              That richer picture is only useful if a school can actually
              organise it. A learner might be Meeting Expectation in most of
              a subject&apos;s sub-strands but consistently Below Expectation
              in one specific area — information a single overall grade would
              hide completely, but which is exactly what a teacher needs to
              know to intervene early.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 4 — KICD and KNEC */}
      <Section tone="canvas">
        <div className="mx-auto max-w-3xl">
          <Reveal>
            <Eyebrow>The Two Bodies Schools Work With</Eyebrow>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
              The role of KICD and KNEC in Kenya&apos;s competency-based system
            </h2>
          </Reveal>
          <Reveal className="mt-8">
            <h3 className="text-lg font-semibold text-marketing-navy-950">KICD: the curriculum</h3>
            <p className="mt-2 text-base leading-relaxed text-marketing-navy-900/75">
              The Kenya Institute of Curriculum Development designs and
              approves the curriculum itself — the National Goals of
              Education, learning outcomes, and the strand/sub-strand
              structure every learning area is organised around. When a
              school talks about &quot;the curriculum,&quot; they&apos;re
              working from a KICD curriculum design.
            </p>
          </Reveal>
          <Reveal className="mt-6">
            <h3 className="text-lg font-semibold text-marketing-navy-950">KNEC: the assessment</h3>
            <p className="mt-2 text-base leading-relaxed text-marketing-navy-900/75">
              The Kenya National Examinations Council is responsible for
              assessment within that curriculum, through the Competency Based
              Assessment (CBA) framework. KNEC develops standardised
              assessment tools for School-Based Assessment, administers
              national assessments such as KPSEA and KJSEA, and sets the
              rules for how classroom, school-based, and national assessment
              combine into a learner&apos;s recorded achievement.
            </p>
          </Reveal>
          <Reveal className="mt-6">
            <p className="text-base leading-relaxed text-marketing-navy-900/75">
              In short: KICD defines what should be taught and assessed;
              KNEC defines how that assessment is structured and reported at
              a national level. Neither body publishes school-management
              software, which is exactly the gap a system like EduCore is
              built to fill — organising the assessment data schools are
              already required to generate.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* 5 — Core: EduCore's CBC/CBE capabilities */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">Where EduCore Fits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Bringing CBC/CBE assessment into a connected school platform
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            Every capability below is live in EduCore today — built directly
            around how sub-strand competency assessment actually works, not
            adapted after the fact from a percentage-based system.
          </p>
        </Reveal>

        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
          <Reveal>
            <Layers className="h-5 w-5 text-marketing-gold-400" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Strand and sub-strand assessment</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Each subject&apos;s strands and sub-strands are set up per
              school, and every rating is recorded at the sub-strand level —
              the same granularity KICD&apos;s own curriculum designs use —
              not a single subject-wide guess.
            </p>
          </Reveal>
          <Reveal>
            <ClipboardCheck className="h-5 w-5 text-marketing-gold-400" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Four-level competency ratings</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Competency levels are configurable per school and validated
              against the class&apos;s grading model, so a rating can never
              be accidentally recorded against the wrong scale.
            </p>
          </Reveal>
          <Reveal>
            <Users className="h-5 w-5 text-marketing-gold-400" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Teacher-scoped assessment workflows</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              A teacher can only enter competency ratings for classes and
              subjects they actually teach. Once an exam is closed, editing a
              rating requires a stated reason — assessment records stay
              accountable, not silently editable.
            </p>
          </Reveal>
          <Reveal>
            <ImageIcon className="h-5 w-5 text-marketing-gold-400" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Evidence attached to every rating</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              A teacher can attach a photo, recording, or work sample as
              proof behind a specific sub-strand rating — turning &quot;Meeting
              Expectation&quot; from a label into something backed by real
              evidence of the work.
            </p>
          </Reveal>
          <Reveal>
            <FileText className="h-5 w-5 text-marketing-gold-400" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Report cards parents can actually read</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Once released, a guardian sees their child&apos;s full
              strand-by-strand breakdown alongside the teacher&apos;s
              comment — not just one final grade with no context behind it.
            </p>
          </Reveal>
          <Reveal>
            <Sparkles className="h-5 w-5 text-marketing-gold-400" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">AI-assisted comments, teacher-reviewed</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              A draft comment can be generated to save a teacher time, but it
              is never visible to a parent until a teacher approves it or
              writes their own — the same review a fully manual comment would
              get.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* 6 — Assessment records to performance intelligence */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Real Value</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            From assessment records to performance intelligence
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              Collecting assessment data is only step one. The real value is
              in what a school does with it — moving from &quot;what mark did
              the learner get?&quot; to &quot;how is this learner
              progressing, and where do they need support?&quot;
            </p>
            <p>
              School leadership can ask Ask EduCore AI direct questions and
              get an answer grounded entirely in the school&apos;s own recent
              records — never a guess, never generated freely: which
              competency levels a recent exam&apos;s sub-strand ratings fall
              into, and which specific students have multiple &quot;Below
              Expectation&quot; ratings and may need targeted intervention.
              For subjects still graded numerically, the same kind of
              question — which subjects and classes are performing below
              average — is answered the same grounded way.
            </p>
            <p>
              One deliberate design choice worth noting: CBC/CBE moved away
              from class-wide rankings, since comparing learners against
              each other works against a system built to measure individual
              competency. EduCore reflects that directly — numeric-graded
              classes are ranked by average score, but competency-graded
              classes are not force-ranked against a scale that was never
              designed to be averaged into a single number. Instead, every
              learner&apos;s full competency picture stays visible at the
              level it actually means something: per sub-strand, per
              subject, per learner.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 7 — Ready for KNEC's own CBA portal */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Staying Submission-Ready</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Ready when it&apos;s time to report to KNEC
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            KNEC&apos;s own Competency-Based Assessment portal is where
            schools submit assessment data directly — EduCore doesn&apos;t
            replace that or claim to be connected to it. What it does is keep
            a school&apos;s own competency records organised and ready: a
            registrar can generate a clearly labelled export of a
            school&apos;s sub-strand ratings, organised by student, ready to
            work from when submitting through KNEC&apos;s own portal, and
            EduCore keeps a record of what was prepared, by whom, and when —
            so submission time isn&apos;t a scramble to reconstruct records
            from scattered mark sheets.
          </p>
        </Reveal>
      </Section>

      {/* 8 — Why more than a spreadsheet */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Case for Structure</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Why CBC/CBE assessment outgrows a spreadsheet fast
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              A spreadsheet can hold one mark per subject well enough. It
              struggles badly once a school is tracking sub-strand-level
              ratings across every learner, every subject, every term — the
              actual shape of CBC/CBE assessment. Formulas break, versions
              multiply across teachers&apos; laptops, and reconstructing one
              learner&apos;s full competency history means hunting through
              months of separate files.
            </p>
            <p>
              A structured system instead gives every teacher a shared,
              current picture: consistent rating entry, an accountable
              history of every change, evidence attached at the point a
              rating is made, and reports that are generated rather than
              manually assembled at the end of every term. The administrative
              load doesn&apos;t disappear — it just stops falling entirely on
              whichever teacher is best with Excel.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 9 — Future of digital school management */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">The Bigger Picture</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            One connected environment, not an assessment tool bolted onto everything else
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            CBC/CBE assessment doesn&apos;t happen in isolation from the rest
            of a school. The same platform that records a learner&apos;s
            competency ratings also handles admissions, attendance, fee
            collection with M-Pesa built in, staff records, timetabling, and
            parent communication over WhatsApp and SMS — with{" "}
            <Link href="/cbc-school-management" className="font-semibold text-marketing-gold-400 underline underline-offset-4">
              CBC and numeric grading configurable side by side
            </Link>{" "}
            for schools moving through the transition at their own pace. One
            connected environment, with learner performance kept at the
            centre of it rather than treated as a separate system to
            reconcile against everything else.
          </p>
        </Reveal>
      </Section>

      {/* 10 — FAQ */}
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

      {/* 11 — Final CTA */}
      <Section tone="navy" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow tone="dark">Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            See how EduCore handles CBC/CBE assessment for your school.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            A demo is built around your school&apos;s own grading model,
            subjects, and classes — see how learner performance, assessment,
            and everyday school operations come together in one place.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/contact">
                Book a Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/cbc-school-management">Explore CBC School Management</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
