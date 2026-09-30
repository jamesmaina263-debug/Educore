import type { Metadata } from "next";
import Link from "next/link";
import { Atom, Users, Palette, GraduationCap, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";

const SLUG = "senior-school-pathways-kenya-stem-social-sciences-arts-sports";
const PATH = `/blog/${SLUG}`;
const PUBLISHED_ON = "2026-09-29";
const TITLE = "Senior School Pathways in Kenya: STEM, Social Sciences, Arts & Sports Science Explained — EduCore";
const DESCRIPTION =
  "What the three CBC Senior School pathways cover, their tracks and subjects, how learners are placed, and how schools can guide a Grade 9 learner's choice.";
const KICD_SITE = "https://kicd.ac.ke";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH, images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

// Sourcing (researched Sep 2026, not from memory — this area has changed
// repeatedly and training-data knowledge on it is not trustworthy):
//   - Three pathways confirmed across multiple independent Kenyan outlets
//     (educationnews.co.ke, peopledaily.digital, kenyans.co.ke, thestandard.ke,
//     eastleighvoice.co.ke): STEM; Social Sciences; Arts and Sports Science.
//   - Senior School = Grade 10-12, entered after Grade 9 and KJSEA placement.
//   - Track structure per multiple sources: STEM has three tracks (Pure
//     Sciences; Applied Sciences; Technical Studies). Social Sciences has two
//     tracks (Languages and Literature; Humanities and Business Studies).
//     Arts and Sports Science has two tracks (Arts; Sports Science).
//   - Core/compulsory subjects cited across sources: English, Kiswahili or
//     Kenyan Sign Language, Mathematics (Core Mathematics for STEM, Essential
//     Mathematics for other pathways per one source), Community Service
//     Learning / Community Learning Project, Physical Education.
//   - Projected enrolment split cited by kenyans.co.ke and educationnews.co.ke:
//     roughly 60% STEM, 25% Social Sciences, 15% Arts and Sports Science —
//     stated as a Ministry/KICD projection, not a quota, and not repeated as
//     if it were a rule for any individual school.
//   - Schools vary in how many pathways they offer (single/double/triple
//     pathway), per educationnews.co.ke and thestandard.ke — the post says
//     to confirm with each school rather than assuming all three are offered.
//   - Subject lists per track are summarised at a high level and flagged as
//     subject to confirmation with the current KICD design, since technical
//     study subjects (e.g. Media Technology, Marine and Fisheries Technology)
//     were still being finalised for particular schools per one source.
// Claims about EduCore checked against the repo
// (src/app/(app)/academics/pathway-guidance, src/lib/academics/pathway-fit.ts):
//   - Pathway Guidance page defaults to a Grade 9 class (matched on class
//     name), but any class can be selected.
//   - It computes an ADVISORY pathway-fit signal per student from marks
//     already recorded against pathway-mapped, non-Core subjects (subject
//     catalogue's pathway field), requiring at least 2 distinct scored
//     subjects before showing a comparison; otherwise marked ineligible with
//     a reason.
//   - Scores CBC competency bands (Exceeding/Meeting/Approaching/Below,
//     matched by label text) and raw/max numeric scores; unrecognised
//     wording contributes no score rather than a guess.
//   - It is explicitly described in the product's own subtitle as advisory
//     and "never a requirement" — this post preserves that framing and does
//     not claim the tool assigns or recommends a pathway on the school's
//     behalf.

const FAQS = [
  {
    q: "What are the three Senior School pathways?",
    a: "STEM (Science, Technology, Engineering and Mathematics), Social Sciences, and Arts and Sports Science. Every learner joining Senior School, from Grade 10, chooses one.",
  },
  {
    q: "When do learners choose a pathway?",
    a: "At the end of Grade 9, the last year of Junior School, based on their results (including the Kenya Junior Secondary School Education Assessment) together with their interests and school-based guidance.",
  },
  {
    q: "Can a learner change pathway after joining Senior School?",
    a: "Reports on the policy say a change is possible but is best made early, since switching later can disrupt a learner's progress in subjects they have already started.",
  },
  {
    q: "Does every school offer all three pathways?",
    a: "No. Coverage depends on a school's staffing and facilities. Some offer all three (triple-pathway schools), some offer two, and some offer one. Confirm what a specific school offers before assuming a pathway is available there.",
  },
  {
    q: "Is a computed pathway match the same as an assignment?",
    a: "No. Any tool that scores recorded marks against pathway subjects, including the one in EduCore, is advisory only. It highlights a signal from performance so far; the actual choice still involves the learner, parents and the school's own guidance process.",
  },
];

const PATHWAYS = [
  {
    icon: Atom,
    name: "STEM",
    tracks: "Pure Sciences · Applied Sciences · Technical Studies",
    body: "Mathematics, Biology, Chemistry and Physics anchor Pure Sciences. Applied Sciences covers subjects like Computer Science, Agriculture and Home Science. Technical Studies covers hands-on fields such as building and construction, electrical, power mechanics and aviation, where a school offers them.",
  },
  {
    icon: Users,
    name: "Social Sciences",
    tracks: "Languages and Literature · Humanities and Business Studies",
    body: "Languages and Literature covers English, Kiswahili, indigenous languages and options like French, German or Mandarin. Humanities and Business Studies covers Religious Education, Business Studies, History and Citizenship, and Geography.",
  },
  {
    icon: Palette,
    name: "Arts and Sports Science",
    tracks: "Arts · Sports Science",
    body: "The Arts track covers music and dance, theatre and film, and fine arts. Sports Science covers sports, recreation and physical education for learners aiming at careers in athletics, coaching or sports administration.",
  },
];

export default function SeniorSchoolPathwaysPost() {
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
        items={[HOME_CRUMB, { name: "Blog", path: "/blog" }, { name: "Senior School Pathways Explained", path: PATH }]}
      />
      <ArticleJsonLd headline={TITLE} description={DESCRIPTION} path={PATH} datePublished={PUBLISHED_ON} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Senior School Pathways in Kenya: STEM, Social Sciences, Arts &amp; Sports Science
        </h1>
        <BlogByline publishedOn={PUBLISHED_ON} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Senior School (Grade 10 to 12) is where CBC learners specialise. This guide explains the three pathways,
          their tracks, how placement works, and how schools support a Grade 9 learner making the choice.
        </p>
      </Section>

      {/* 2 — What Senior School is */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Basics</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Grade 9 ends Junior School; Grade 10 begins specialisation
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              Junior School runs Grades 7 to 9 and keeps learners on a broad, common curriculum. Senior School, Grades
              10 to 12, is where that changes: each learner chooses one of three pathways and studies a mix of
              compulsory subjects alongside subjects specific to their pathway and track.
            </p>
            <p>
              Placement into a pathway follows Grade 9 results, including the Kenya Junior Secondary School Education
              Assessment, together with the learner&apos;s own interests and the school&apos;s guidance process. Since the
              structure has been refined more than once on the way to the first Grade 10 cohort, always check the
              current guidance from{" "}
              <a
                href={KICD_SITE}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-marketing-navy-950 underline underline-offset-4"
              >
                KICD
              </a>{" "}
              and the Ministry of Education rather than a copy from a previous year.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — The three pathways */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">The Three Pathways</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Each pathway splits into tracks
          </h2>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-5xl gap-8 sm:grid-cols-3">
          {PATHWAYS.map((p) => (
            <Reveal key={p.name}>
              <p.icon className="h-6 w-6 text-marketing-gold-400" strokeWidth={1.75} />
              <p className="mt-3 text-base font-semibold text-white">{p.name}</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-marketing-gold-400/80">{p.tracks}</p>
              <p className="mt-3 text-sm leading-relaxed text-white/70">{p.body}</p>
            </Reveal>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-white/50">
          Exact subjects offered depend on a school&apos;s staffing and facilities — confirm the current design and a
          specific school&apos;s offering before treating any subject list as final.
        </p>
      </Section>

      {/* 4 — Compulsory subjects */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Every Learner</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Compulsory subjects, regardless of pathway
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/75">
            Alongside their pathway subjects, every Senior School learner takes English, Kiswahili or Kenyan Sign
            Language, Mathematics, Physical Education, and Community Service Learning. Mathematics is taught at a
            different depth depending on pathway, with STEM learners taking a more advanced course than learners in
            the other two pathways.
          </p>
        </Reveal>
      </Section>

      {/* 5 — Which pathway learners choose */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">In Numbers</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            What the projections say, and why they aren&apos;t a quota
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            Ministry projections reported in the Kenyan press expect roughly 60% of learners nationally to lean
            towards STEM, 25% towards Social Sciences, and 15% towards Arts and Sports Science. That is a national
            planning estimate, not a cap on any single school or class — a school&apos;s actual mix depends on its
            learners&apos; results and interests, and on which pathways it is able to offer.
          </p>
        </Reveal>
      </Section>

      {/* 6 — How schools can help */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Guiding The Choice</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Helping a Grade 9 learner choose well
          </h2>
          <ul className="mt-6 flex list-disc flex-col gap-3 pl-5 text-base leading-relaxed text-marketing-navy-900/75">
            <li>Look at recorded performance across pathway-relevant subjects, not one strong or weak result in isolation.</li>
            <li>Talk to the learner about interest and career direction, not only grades — a pathway is a three-year commitment.</li>
            <li>Check what your school can actually offer: tracks and subjects depend on staffing and facilities.</li>
            <li>Involve parents early, since a pathway choice is easier to adjust before Senior School starts than after.</li>
            <li>Keep the guidance process documented, in case a learner or family asks to revisit the choice.</li>
          </ul>
        </Reveal>
      </Section>

      {/* 7 — Where EduCore fits */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Where EduCore Fits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            A signal from the marks you already have
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              EduCore&apos;s Pathway Guidance page defaults to a school&apos;s Grade 9 class, the natural point to start
              this conversation, though any class can be selected. For each learner, it compares recorded marks in
              subjects mapped to STEM, Social Sciences and Arts &amp; Sports Science (Core subjects are excluded, since
              every learner takes them regardless of pathway) and shows which pathway their performance so far leans
              towards.
            </p>
            <p>
              It needs at least two distinct scored subjects before showing a comparison for a learner; below that, it
              says so rather than guessing. It reads whatever grading a school already uses, numeric marks or CBC
              competency bands, and skips a mark it cannot score with confidence instead of estimating one.
            </p>
            <p>
              The page states plainly that this is <strong>advisory guidance, never a requirement</strong>. It does not
              assign, block or recommend a pathway on the school&apos;s behalf; it gives teachers and guidance staff one
              more piece of evidence for a conversation the learner, parents and school still have together.
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
            EduCore is not affiliated with KICD, KNEC or the Ministry of Education. Senior School structure and
            placement rules have changed more than once during rollout, so confirm current requirements with KICD and
            your county education office before relying on this guide.
          </p>
        </Reveal>
      </Section>

      {/* 9 — CTA */}
      <Section tone="navy" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow tone="dark">Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Guide pathway choices with the marks you already record.
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
              <Link href="/cbc-school-management">
                Explore CBC Management <GraduationCap className="h-4 w-4" />
              </Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
