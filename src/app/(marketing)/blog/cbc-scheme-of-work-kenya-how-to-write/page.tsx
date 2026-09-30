import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Target, Lightbulb, ClipboardCheck, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";

const SLUG = "cbc-scheme-of-work-kenya-how-to-write";
const PATH = `/blog/${SLUG}`;
const PUBLISHED_ON = "2026-09-28";
const TITLE = "How to Write a CBC Scheme of Work in Kenya: Columns, Example and Common Mistakes — EduCore";
const DESCRIPTION =
  "What a CBC scheme of work is, the columns most Kenyan schools use, a worked example row, how it differs from a lesson plan, and the mistakes that get schemes sent back.";
const KICD_SITE = "https://kicd.ac.ke";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH, images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

// Sourcing (researched Sep 2026, not from memory):
//   - The commonly used CBC scheme-of-work columns (Week, Lesson, Strand,
//     Sub-strand, Specific Learning Outcomes, Learning Experiences, Key
//     Inquiry Questions, Learning Resources, Assessment, Reflection) are
//     the layout published on Kenyan education sites and university
//     teacher-training templates. Worded as "the layout most schools use",
//     NOT as a regulation. There is no claim of a single mandated format;
//     schools should follow what their head teacher / TSC guidance asks.
//   - The example row is ILLUSTRATIVE and is labelled as such. It is not
//     copied from a KICD curriculum design.
// Claims about EduCore were checked against the repo
// (src/app/(app)/academics/scheme-of-work):
//   - Schemes are created per term/class/stream/subject/teacher, with
//     total weeks and lessons per week.
//   - Entries hold week, lesson, date, topic, subtopic, learning outcomes,
//     content, activities, teaching methods, resources, assessment methods,
//     references, remarks, and a completion status.
//   - Status flow: Draft, In Progress, Submitted, Under Review, Approved.
//   - Optional AI draft (needs GEMINI_API_KEY configured, permission-gated):
//     returns a draft for the teacher to review; nothing is saved until the
//     teacher clicks Save. It uses the school's own recorded curriculum
//     sub-strands as grounding when they exist.
//   - A print view exists at scheme-of-work/[id]/print.
//   - EduCore entries use "topic/subtopic" field names, NOT strand/sub-strand
//     columns. The post therefore does NOT claim strand/sub-strand columns.
//   - No downloadable template is offered, and none is claimed.

const FAQS = [
  {
    q: "What is a scheme of work under CBC?",
    a: "A scheme of work is the teacher's week-by-week plan for one learning area, in one class, for one term. It shows what will be taught, how it will be taught, what resources it needs and how learning will be checked. It is the term-level picture; a lesson plan is the detail for a single lesson.",
  },
  {
    q: "Is there one official scheme of work format?",
    a: "Most Kenyan schools use a similar set of columns (see the table in this post), but formats vary between schools, sub-counties and levels. Your head teacher or the guidance your school follows decides what is required, so confirm it before you print a term's worth of schemes.",
  },
  {
    q: "What is the difference between a scheme of work and a lesson plan?",
    a: "The scheme covers a whole term across many lessons and stays fairly light on detail. A lesson plan covers one lesson and goes deeper: the introduction, the development, the conclusion, the assessment and the teacher's own evaluation afterwards.",
  },
  {
    q: "Should I use 'topic' and 'subtopic' or 'strand' and 'sub-strand'?",
    a: "Under CBC the curriculum designs are organised into strands and sub-strands, so most CBC schemes name them explicitly instead of using 8-4-4 chapter titles. Check the wording your school expects and follow the KICD curriculum design for the grade.",
  },
  {
    q: "Can AI write my scheme of work?",
    a: "It can produce a first draft, which saves time on the blank page. It cannot know your learners, your resources or what your school has already covered, so a teacher has to read it, correct it and own it. In EduCore, an AI draft is only shown for review and nothing is saved until the teacher chooses to save it.",
  },
];

const PARTS = [
  {
    icon: CalendarDays,
    title: "Anchor it to the term",
    body: "Count the real teaching weeks first. Subtract exam weeks, public holidays and school events, then spread the content across what is left.",
  },
  {
    icon: Target,
    title: "Start from the curriculum design",
    body: "Take the strands, sub-strands and specific learning outcomes for your grade from the KICD design. The design is the input; your scheme is your plan for delivering it.",
  },
  {
    icon: Lightbulb,
    title: "Write learner activities, not teacher actions",
    body: "Learning experiences describe what learners do: observe, discuss, measure, build, present. \"Teacher explains\" says little about how competencies will be developed.",
  },
  {
    icon: ClipboardCheck,
    title: "Plan the assessment and leave room to reflect",
    body: "Name how you will check each sub-strand (observation, oral questions, a task, a rubric), and keep a reflection column you actually fill in after teaching.",
  },
];

const COLUMNS = [
  ["Week / Lesson", "Where this entry sits in the term."],
  ["Strand and sub-strand", "The curriculum area and its component, using KICD's wording."],
  ["Specific learning outcomes", "What the learner should be able to do by the end, phrased as observable actions."],
  ["Learning experiences", "The activities learners will do."],
  ["Key inquiry questions", "Open questions that start discussion and link the lesson to real life."],
  ["Learning resources", "Materials, realia, books and digital tools you need."],
  ["Assessment", "How you will check that learning happened."],
  ["Reflection", "Filled in after teaching: what worked, what to repeat or reteach."],
];

export default function CbcSchemeOfWorkKenyaPost() {
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
        items={[HOME_CRUMB, { name: "Blog", path: "/blog" }, { name: "How to Write a CBC Scheme of Work", path: PATH }]}
      />
      <ArticleJsonLd headline={TITLE} description={DESCRIPTION} path={PATH} datePublished={PUBLISHED_ON} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          How to Write a CBC Scheme of Work in Kenya: Columns, Example and Common Mistakes
        </h1>
        <BlogByline publishedOn={PUBLISHED_ON} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Every teacher writes one for every learning area, every term. Done well, a scheme of work is the map that
          keeps a term on track. Done in a hurry, it is a table copied from last year. This guide covers what it is,
          the columns most schools use, and how to write one that actually helps you teach.
        </p>
      </Section>

      {/* 2 — What it is */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Basics</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            A scheme of work is the term-level plan
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              A scheme of work sets out, week by week, what one teacher will teach in one learning area, in one class,
              for one term. It sits between the curriculum design, which says what learners should learn over a grade,
              and the lesson plan, which says exactly what happens in a single lesson.
            </p>
            <p>
              The curriculum design comes from the{" "}
              <a
                href={KICD_SITE}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-marketing-navy-950 underline underline-offset-4"
              >
                Kenya Institute of Curriculum Development
              </a>
              . Think of the design as the input and your scheme as your plan for delivering it: the same design
              produces a different scheme in a school with a science lab than in one without.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — Columns */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">The Layout</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            The columns most schools use
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            There is no single format every school follows, so confirm what your head teacher expects. This is the
            layout you will see most often on CBC scheme templates:
          </p>
          <dl className="mt-8 flex flex-col gap-5">
            {COLUMNS.map(([name, desc]) => (
              <div key={name}>
                <dt className="text-sm font-semibold text-marketing-gold-400">{name}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-white/70">{desc}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Section>

      {/* 4 — Example row */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Worked Example</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            What one row can look like
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/75">
            This is an illustration of the level of detail, not a row copied from a KICD design. Always take your
            strands, sub-strands and outcomes from the current design for your grade.
          </p>
          <div className="mt-6 overflow-x-auto rounded-xl border border-marketing-navy-900/10 bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <tbody className="divide-y divide-marketing-navy-900/10 text-marketing-navy-900/80">
                {[
                  ["Week / Lesson", "3 / 2"],
                  ["Strand", "Numbers"],
                  ["Sub-strand", "Fractions"],
                  ["Specific learning outcome", "Compare two fractions using paper folding and drawings."],
                  ["Learning experiences", "In groups, fold paper strips to show halves and quarters, then compare and explain which is larger."],
                  ["Key inquiry question", "How do we know which share is bigger?"],
                  ["Learning resources", "Paper strips, crayons, charts."],
                  ["Assessment", "Observation of group work; two oral questions per group."],
                  ["Reflection", "(Filled in after the lesson.)"],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row" className="w-1/3 bg-marketing-navy-900/[0.03] px-4 py-3 font-semibold text-marketing-navy-950">
                      {label}
                    </th>
                    <td className="px-4 py-3">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </Section>

      {/* 5 — How to write one */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">Method</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Four steps to a scheme you will use
          </h2>
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

      {/* 6 — Scheme vs lesson plan */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Don&apos;t Mix Them Up</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Scheme of work vs lesson plan
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              The scheme covers a term and stays short per lesson: an outcome, an activity, a resource, a way to check.
              The lesson plan covers one lesson and goes deeper, with an introduction, development, conclusion,
              assessment and a self-evaluation once the lesson is over.
            </p>
            <p>
              A good scheme makes lesson plans quick to write, because the outcome, activity and resources are already
              decided. If you find yourself re-planning every lesson from scratch, the scheme is too vague.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 7 — Mistakes */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Common Mistakes</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            What gets a scheme sent back
          </h2>
          <ul className="mt-6 flex list-disc flex-col gap-3 pl-5 text-base leading-relaxed text-white/75">
            <li>Copying last year&apos;s scheme without checking the weeks, dates and current curriculum design.</li>
            <li>Planning more content than the term has teaching weeks, so the last strands never get taught.</li>
            <li>Writing teacher actions (&quot;explain&quot;, &quot;give notes&quot;) instead of what learners will do.</li>
            <li>Using 8-4-4 chapter titles where the school expects strands and sub-strands.</li>
            <li>Learning outcomes that can&apos;t be observed, like &quot;understand fractions&quot;.</li>
            <li>Leaving assessment and reflection blank, so there is no record of what was actually covered.</li>
          </ul>
        </Reveal>
      </Section>

      {/* 8 — Where EduCore fits */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Where EduCore Fits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            From spreadsheet to one shared record
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              In EduCore, a teacher creates a scheme for a term, class, stream and subject, sets the number of weeks and
              lessons per week, and fills in each entry: topic, subtopic, learning outcomes, activities, teaching
              methods, resources, assessment methods, references and remarks. Each entry has a completion status, so a
              teacher (and the school) can see how far the term has got.
            </p>
            <p>
              A scheme moves through Draft, In Progress, Submitted, Under Review and Approved, which replaces the
              paper trail of schemes handed to the head teacher and lost in a pile. There is also a print view for
              schools that still want a signed paper copy.
            </p>
            <p>
              Where it is switched on for a school, teachers can ask for an AI-generated first draft. The draft is
              shown for review only: nothing is saved until the teacher clicks Save, and where the school has recorded
              its curriculum sub-strands for the subject, the draft is grounded in them. It is a starting point to
              edit, not a finished scheme.
            </p>
            <p>
              For how assessment records work once teaching is under way, read our{" "}
              <Link
                href="/blog/cbc-cbe-assessment-learner-performance-kenya"
                className="font-semibold text-marketing-navy-950 underline underline-offset-4"
              >
                guide to CBC/CBE assessment
              </Link>
              .
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 9 — FAQ */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Common Questions</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-8 flex flex-col gap-6">
            {FAQS.map((f) => (
              <div key={f.q}>
                <p className="text-base font-semibold text-white">{f.q}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{f.a}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-xs leading-relaxed text-white/50">
            EduCore is not affiliated with KICD, KNEC or the Ministry of Education. Formats and requirements change,
            so confirm what your school and the current curriculum designs require before relying on this guide.
          </p>
        </Reveal>
      </Section>

      {/* 10 — CTA */}
      <Section tone="canvas" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow>Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-marketing-navy-950 sm:text-4xl">
            See schemes of work in one place.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
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
