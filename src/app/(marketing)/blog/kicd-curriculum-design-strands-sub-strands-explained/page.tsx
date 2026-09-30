import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Layers, Target, ListChecks, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";

const SLUG = "kicd-curriculum-design-strands-sub-strands-explained";
const PATH = `/blog/${SLUG}`;
const PUBLISHED_ON = "2026-09-28";
const TITLE = "KICD Curriculum Designs Explained: Strands, Sub-Strands and Learning Outcomes — EduCore";
const DESCRIPTION =
  "How to read a KICD curriculum design: what strands, sub-strands, specific learning outcomes, key inquiry questions, core competencies and PCIs mean, and how to turn them into a term plan.";
const KICD_SITE = "https://kicd.ac.ke";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH, images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

// Sourcing (researched Sep 2026, not from memory):
//   - KICD's own Pre-Primary curriculum designs (kicd.ac.ke) state the seven
//     core competencies: communication and collaboration; critical thinking
//     and problem solving; imagination and creativity; citizenship; digital
//     literacy; learning to learn; self-efficacy. They also state that PCIs
//     are integrated into the designs, and that designs give general and
//     specific learning outcomes.
//   - The typical contents of a design (essence statement, general and
//     specific learning outcomes, strands and sub-strands, suggested learning
//     experiences, key inquiry questions, core competencies, PCIs, values,
//     suggested assessment) are as described in Kenyan education press and
//     teacher-guide sites. Worded as "typically", because the exact layout
//     differs between levels and learning areas.
//   - This post does NOT quote KICD text, list KICD's strands, or give
//     grade-specific content. Readers are sent to kicd.ac.ke for the current
//     design of their grade.
// Claims about EduCore were checked against the repo:
//   - academics/kicd-content: read-only browse of KICD content published
//     centrally by EduCore, by grade PP1 to Grade 12, shown with source
//     attribution and licence reference, gated on the academics.write
//     permission. Coverage depends on what has been published so far, and
//     the post says so.
//   - academics/curriculum: a school records its own curriculum strands and
//     sub-strands.
//   - Scheme-of-work AI draft uses the school's own recorded sub-strands as
//     grounding when they exist; nothing is saved until the teacher saves.

const FAQS = [
  {
    q: "What is a KICD curriculum design?",
    a: "It is the official document, published by the Kenya Institute of Curriculum Development, that sets out what learners should learn in a learning area at a given grade. It typically contains the strands and sub-strands, specific learning outcomes, suggested learning experiences, key inquiry questions, core competencies, values, pertinent and contemporary issues and suggested assessment.",
  },
  {
    q: "What is the difference between a strand and a sub-strand?",
    a: "A strand is a major area of a learning area. A sub-strand is a smaller, teachable part of that strand. Specific learning outcomes, learning experiences and assessment are attached at the sub-strand level, which is why schemes of work and lesson plans usually name both.",
  },
  {
    q: "What are the seven core competencies?",
    a: "KICD's designs list them as communication and collaboration, critical thinking and problem solving, imagination and creativity, citizenship, digital literacy, learning to learn, and self-efficacy. Lessons are expected to develop them alongside the subject content.",
  },
  {
    q: "What are PCIs?",
    a: "PCIs are pertinent and contemporary issues: cross-cutting themes the designs ask teachers to weave into lessons where they fit, such as safety, health, environmental and citizenship themes. They are listed in the design, so pick the ones that genuinely fit the lesson and don't list them all by habit.",
  },
  {
    q: "Where do I get the current curriculum design for my grade?",
    a: "From KICD at kicd.ac.ke. Designs are updated, and rationalised versions have been issued for some grades, so always work from the current version for your grade and learning area rather than a copy from a previous year.",
  },
];

const PARTS = [
  {
    icon: Layers,
    title: "Strands",
    body: "The major areas of a learning area. A term usually covers only some of them, and the design tells you which.",
  },
  {
    icon: BookOpen,
    title: "Sub-strands",
    body: "The teachable units inside a strand. This is the level at which outcomes, activities and assessment are attached.",
  },
  {
    icon: Target,
    title: "Specific learning outcomes",
    body: "What a learner should be able to do by the end of a sub-strand, phrased as something you can observe.",
  },
  {
    icon: ListChecks,
    title: "Experiences, questions and assessment",
    body: "Suggested learning experiences, key inquiry questions and assessment ideas that help you plan the lessons.",
  },
];

const COMPETENCIES = [
  "Communication and collaboration",
  "Critical thinking and problem solving",
  "Imagination and creativity",
  "Citizenship",
  "Digital literacy",
  "Learning to learn",
  "Self-efficacy",
];

export default function KicdCurriculumDesignPost() {
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
        items={[HOME_CRUMB, { name: "Blog", path: "/blog" }, { name: "KICD Curriculum Designs Explained", path: PATH }]}
      />
      <ArticleJsonLd headline={TITLE} description={DESCRIPTION} path={PATH} datePublished={PUBLISHED_ON} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          KICD Curriculum Designs Explained: Strands, Sub-Strands and Learning Outcomes
        </h1>
        <BlogByline publishedOn={PUBLISHED_ON} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Every scheme of work and lesson plan under CBC/CBE starts from the same document: the KICD curriculum design
          for the grade. This guide explains how it is organised, what each part is for, and how to turn it into a plan
          for the term.
        </p>
      </Section>

      {/* 2 — What it is */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Basics</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            The design is the authority; your scheme is your plan
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              The{" "}
              <a
                href={KICD_SITE}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-marketing-navy-950 underline underline-offset-4"
              >
                Kenya Institute of Curriculum Development
              </a>{" "}
              publishes a curriculum design for each learning area at each level. A design is not a textbook. It does
              not tell you how to teach every lesson; it states what learners should know, do and value, and it
              suggests ways to get there.
            </p>
            <p>
              Because it sets the expected breadth, depth and sequence of learning, everything a teacher writes
              afterwards, from the scheme of work to the lesson plan to the assessment, should trace back to it. If your
              document names a strand or outcome that is not in the design, it is easy for a head teacher or quality
              assurance officer to spot.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — Anatomy */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">Anatomy</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            The four parts you will use most
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            Layouts differ a little between levels and learning areas, but a design typically works down this chain:
            strand, sub-strand, specific learning outcome, lesson, assessment.
          </p>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
          {PARTS.map((item) => (
            <Reveal key={item.title}>
              <item.icon className="h-5 w-5 text-marketing-gold-400" strokeWidth={1.75} />
              <p className="mt-3 text-sm font-semibold text-white">{item.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/70">{item.body}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 4 — Competencies, values, PCIs */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Cross-Cutting Parts</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Core competencies, values and PCIs
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              Alongside the subject content, each sub-strand lists the core competencies it helps develop, the values it
              supports, and the pertinent and contemporary issues (PCIs) that fit it. KICD&apos;s designs name seven
              core competencies:
            </p>
            <ul className="grid list-disc gap-x-8 gap-y-1 pl-5 sm:grid-cols-2">
              {COMPETENCIES.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p>
              The common mistake is to tick every box on every lesson. Choose the competencies and PCIs that a lesson
              genuinely develops, and be ready to say how, in terms of what learners do.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 5 — From design to term plan */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">In Practice</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Turning the design into a term plan
          </h2>
          <ol className="mt-6 flex list-decimal flex-col gap-3 pl-5 text-base leading-relaxed text-white/75">
            <li>Open the current design for your grade and learning area, and note the strands and sub-strands your school covers this term.</li>
            <li>Count your real teaching weeks, minus exams, holidays and events.</li>
            <li>Share the sub-strands across those weeks, giving bigger or harder ones more lessons.</li>
            <li>For each sub-strand, pick the specific learning outcomes you will teach, and write them the way the design does.</li>
            <li>Choose learner activities and resources you can really provide, and decide how you will assess each sub-strand.</li>
            <li>Turn that into your scheme of work, then into lesson plans as each week comes up.</li>
          </ol>
          <p className="mt-6 text-base leading-relaxed text-white/75">
            Our guide to{" "}
            <Link
              href="/blog/cbc-scheme-of-work-kenya-how-to-write"
              className="font-semibold text-marketing-gold-400 underline underline-offset-4"
            >
              writing a CBC scheme of work
            </Link>{" "}
            covers steps 5 and 6 in detail.
          </p>
        </Reveal>
      </Section>

      {/* 6 — Mistakes */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Common Mistakes</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Where teachers go wrong with the design
          </h2>
          <ul className="mt-6 flex list-disc flex-col gap-3 pl-5 text-base leading-relaxed text-marketing-navy-900/75">
            <li>Writing strand names from memory or from a textbook chapter list instead of the design.</li>
            <li>Using an old version of the design after it has been updated for the grade.</li>
            <li>Planning by textbook chapter, so sub-strands the book covers thinly get skipped.</li>
            <li>Writing outcomes that cannot be observed, like &quot;understand&quot; or &quot;know&quot;.</li>
            <li>Listing every core competency and PCI on every lesson instead of the ones that fit.</li>
          </ul>
        </Reveal>
      </Section>

      {/* 7 — Where EduCore fits */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Where EduCore Fits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Keep the reference next to the plan
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              In EduCore, school leaders with academic permissions can browse KICD curriculum content that EduCore has
              published centrally, filtered by grade from PP1 to Grade 12. It is a read-only reference, each source
              shows its attribution and licence reference, and coverage depends on what has been published so far. It
              does not replace the official design on kicd.ac.ke, which remains the authority.
            </p>
            <p>
              Schools can also record their own curriculum strands and sub-strands. When a teacher asks for an AI first
              draft of a scheme of work, those recorded sub-strands are used as grounding for the subject where they
              exist. The draft is shown for review only, and nothing is saved until the teacher saves it.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 8 — FAQ */}
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
          <p className="mt-8 text-xs leading-relaxed text-marketing-navy-900/50">
            EduCore is not affiliated with KICD, KNEC or the Ministry of Education. Designs and requirements change, so
            confirm details against KICD&apos;s current publications at kicd.ac.ke before relying on this guide.
          </p>
        </Reveal>
      </Section>

      {/* 9 — CTA */}
      <Section tone="navy" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow tone="dark">Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Plan from the curriculum, in one place.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            A demo is built around your school&apos;s own classes and subjects, not a generic product tour.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/contact">
                Book a Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/cbc-school-management">Explore CBC Management</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
