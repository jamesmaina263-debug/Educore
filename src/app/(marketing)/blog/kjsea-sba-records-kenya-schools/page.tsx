import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, FolderCheck, CalendarClock, FileSpreadsheet, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";

const SLUG = "kjsea-sba-records-kenya-schools";
const PATH = `/blog/${SLUG}`;
const PUBLISHED_ON = "2026-09-20";
const TITLE = "KJSEA and School-Based Assessment: The Grade 7–8 Records Your School Needs on File — EduCore";
const DESCRIPTION =
  "Grade 7 and 8 school-based assessment makes up a fifth of a learner's KJSEA score. What the SBA actually is, who uploads it, what KNEC asks schools to keep, and where records go missing.";
const KNEC_2026_SBA_CIRCULAR =
  "https://www.knec.ac.ke/wp-content/uploads/2026/04/Guidelines-and-schedule-for-Grades-378-and-SNE-Projects.pdf";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Sourcing for the KNEC facts in this post (researched Sep 2026, not from memory):
//   - KJSEA composite 60% KJSEA exam / 20% KPSEA / 20% Grade 7-8 SBA, and the
//     10% + 10% split across Grades 7 and 8: as announced by the Ministry when
//     the 2025 KJSEA results were released and reported in the Kenyan press.
//     Worded as "announced/reported", not as a quotation of a regulation.
//   - KNEC circular KNEC/GEN/TD/SE/SBA/GUI/2026/02 (23 April 2026), on
//     knec.ac.ke: KNEC uploads SBA projects/performance tasks for Grades 3,
//     7 and 8 to the CBA portal; headteachers log in; schools administer the
//     tasks and upload scores for all learners in the stipulated timeframe;
//     subject teachers score using the provided guidelines; heads of
//     institution are asked to keep all records and evidence generated.
//   - 2026 KJSEA projects circular (as reproduced by Kenyan education news
//     sites): file of evidence on project progress, and a KSh 500 per
//     candidate penalty for uploads after the deadline. Worded as "in its
//     2026 circular for KJSEA projects".
//   - 2026 KJSEA registration circular (same caveat): heads must confirm
//     Grade 7 and 8 SBA scores are uploaded for all learning areas for every
//     candidate being registered.
// Claims about EduCore were checked against the repo:
//   - Marks, competency ratings, per-criterion rubric scores with feedback,
//     and evidence attachments per rating; records attach to the learner
//     across academic years (growth tab is ordered chronologically across
//     years, not by class).
//   - Excel/CSV exports of marks and reports.
//   - Integrations > KNEC CBA: provisional, clearly labelled export with
//     configurable columns (not a live integration -- KNEC has no public API
//     for submission), and school-entered assessment-window reminders with an
//     optional source link. This mirrors the existing CBC/CBE post's wording.
// EduCore does not upload to the KNEC portal and this post says so.

const FAQS = [
  {
    q: "How much do Grade 7 and Grade 8 SBA count towards the KJSEA score?",
    a: "As announced by the Ministry of Education, a learner's KJSEA score is built from 60% the Grade 9 KJSEA assessment, 20% the Grade 6 KPSEA, and 20% school-based assessment from Grades 7 and 8. Press reports of KNEC's guidance describe the 20% as 10% from each of the two years. Check the current KNEC circular for any changes.",
  },
  {
    q: "Who uploads SBA scores to the KNEC portal?",
    a: "KNEC's 2026 circular has headteachers logging into the CBA portal at cba.knec.ac.ke, where schools administer the tasks and upload the scores of all learners. Subject teachers assess learners as they do the tasks, scoring with the guidelines KNEC provides.",
  },
  {
    q: "What records does KNEC expect a school to keep?",
    a: "KNEC's circular asks heads of institution to keep all records and evidence generated from the assessments. For KJSEA projects, its 2026 circular also asks for a file of evidence on each candidate's project progress. In practice that means scoring sheets, work samples and the upload confirmation, kept per learner and per task.",
  },
  {
    q: "Does EduCore upload SBA scores to KNEC for me?",
    a: "No. KNEC has not published a public API for submission, so uploading is done by the school on cba.knec.ac.ke. EduCore keeps the learner records in one place and can produce a clearly labelled provisional export to work from when entering scores; it is not an official integration and does not claim any approval from KNEC.",
  },
  {
    q: "Is school-based assessment the same as our termly CBC report card?",
    a: "No. The SBA that counts toward KJSEA comes from tasks KNEC sets and schools administer and upload. Your own class assessments, portfolios and report cards are a separate record. They matter for learners and parents, but they are not what KNEC adds up for the 20%.",
  },
];

const RECORD_ITEMS = [
  {
    icon: ClipboardCheck,
    title: "A scoring sheet per learner, per task",
    body: "The marks or levels each learner received against KNEC's scoring guide, with the teacher who scored and the date.",
  },
  {
    icon: FolderCheck,
    title: "The evidence behind the score",
    body: "Photos, scanned work or a short record of what the learner produced. KNEC asks heads to keep it; it is what you point to if a score is questioned.",
  },
  {
    icon: FileSpreadsheet,
    title: "Your own copy of what you uploaded",
    body: "A dated export or screenshot of the scores as submitted, so you can compare it with what the portal shows later.",
  },
  {
    icon: CalendarClock,
    title: "The deadline, written down early",
    body: "Each circular sets its own dates. A late upload has cost schools money before, so put the date where more than one person will see it.",
  },
];

export default function KjseaSbaRecordsKenyaSchoolsPost() {
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
          { name: "KJSEA and School-Based Assessment Records", path: PATH },
        ]}
      />
      <ArticleJsonLd headline={TITLE} description={DESCRIPTION} path={PATH} datePublished={PUBLISHED_ON} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          KJSEA and School-Based Assessment: The Grade 7–8 Records Your School Needs on File
        </h1>
        <BlogByline publishedOn={PUBLISHED_ON} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          A fifth of a learner&apos;s KJSEA score is decided before Grade 9
          begins, in the school-based assessments of Grades 7 and 8. Most of
          the attention goes to the exam. This is about the part that is
          easy to lose: what the SBA actually is, who uploads it, and what
          your school should be able to produce if anyone asks.
        </p>
      </Section>

      {/* 2 — The composite */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Arithmetic</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Where the 20% comes from
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              As the Ministry of Education has explained it, a KJSEA score
              is 60% the Grade 9 assessment itself, 20% the learner&apos;s
              Grade 6 KPSEA result, and 20% school-based assessment from
              Grades 7 and 8. Press reports of KNEC&apos;s guidance describe
              that last 20% as 10% from each year. The composite then feeds
              senior school placement.
            </p>
            <p>
              The point for a school: two of the three parts are already in
              the past by the time Grade 9 starts. The Grade 7 and 8 scores
              are the only part the school controls, and the only part it
              can get wrong through record-keeping rather than teaching.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — What SBA actually is */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">A Common Mix-Up</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            The SBA is KNEC&apos;s task, not your report card
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              Under KNEC&apos;s{" "}
              <a
                href={KNEC_2026_SBA_CIRCULAR}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-marketing-gold-400 underline underline-offset-4"
              >
                2026 guidelines for Grade 3, 7 and 8 projects and performance tasks
              </a>
              , KNEC puts the tasks on its CBA portal. The headteacher logs
              in, the school administers the tasks, subject teachers score
              learners as they work using KNEC&apos;s scoring guidelines, and
              the scores for every learner are uploaded within the stated
              timeframe.
            </p>
            <p>
              That is a different record from the class tests, portfolios and
              termly report cards a school keeps for its own purposes. Those
              matter to learners and parents, but they are not what KNEC adds
              up for the 20%. Schools that treat the two as one tend to find
              out at the wrong moment: KNEC&apos;s 2026 KJSEA registration
              circular has heads confirming, when they register candidates,
              that Grade 7 and 8 SBA scores are uploaded in every learning
              area for every one of them.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 4 — What to keep */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>What To Keep</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Four things a school should be able to produce
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
            KNEC asks heads of institution to keep all records and evidence
            generated from these assessments. In practice:
          </p>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
          {RECORD_ITEMS.map((item) => (
            <Reveal key={item.title}>
              <item.icon className="h-5 w-5 text-marketing-gold-600" strokeWidth={1.75} />
              <p className="mt-3 text-sm font-semibold text-marketing-navy-950">{item.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">{item.body}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 5 — Where it goes wrong */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Where It Goes Wrong</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            The gaps usually appear two years later
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              A Grade 7 score is entered by a teacher who later leaves, on
              a sheet that lives in a drawer. The learner transfers, the
              class is restructured, or the same marks are typed twice, once
              on paper and once into the portal, and one of them is wrong.
              None of that is visible until Grade 9 registration, when the
              head has to confirm every learner&apos;s Grade 7 and 8 scores
              are in, and reconstructing them from memory is no longer an
              option.
            </p>
            <p>
              Deadlines carry a cost as well. In its 2026 circular for KJSEA
              projects, KNEC set a penalty of KSh 500 per candidate for
              uploads after the deadline. For a Grade 9 class of a hundred
              learners, that is a real number for a small school.
            </p>
            <p>
              The fix is unglamorous: record each score once, at the time it
              is given, in one place attached to the learner and not to a
              teacher&apos;s file, and work from that copy when you upload.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 6 — What EduCore does and does not do */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Where EduCore Fits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            What it does, and what it deliberately doesn&apos;t
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              EduCore keeps a learner&apos;s marks, competency ratings,
              rubric scores with per-criterion feedback, and attached
              evidence such as photos or scanned work on the learner&apos;s
              own record, and that record stays with the learner as they
              move up through the years. Marks and reports export to Excel
              or CSV, so the person entering scores on the KNEC portal can
              work from a single dated copy.
            </p>
            <p>
              Under Integrations, the KNEC CBA section produces a clearly
              labelled <em>provisional</em> export whose columns your team
              can rename and reorder, and lets school staff enter KNEC
              assessment windows, with a link to the circular they came
              from, so upcoming deadlines show up inside the app.
            </p>
            <p>
              What it does not do: upload to KNEC. KNEC has not published a
              public API for submission, so the head of institution submits
              on cba.knec.ac.ke, and EduCore is not an official KNEC
              integration or approved by KNEC. Its job is to make sure the
              data you upload from is complete, in one place, and yours.
              Read our{" "}
              <Link
                href="/blog/cbc-cbe-assessment-learner-performance-kenya"
                className="font-semibold text-marketing-navy-950 underline underline-offset-4"
              >
                guide to CBC/CBE assessment
              </Link>{" "}
              for how the competency records themselves work.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 7 — FAQ */}
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
            EduCore is not affiliated with KNEC or the Ministry of Education.
            Dates, weightings and procedures change between circulars, so
            confirm details against KNEC&apos;s current publications at
            knec.ac.ke before relying on them.
          </p>
        </Reveal>
      </Section>

      {/* 8 — CTA */}
      <Section tone="canvas" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow>Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-marketing-navy-950 sm:text-4xl">
            See a learner&apos;s records in one place.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
            A demo is built around your school&apos;s own classes and
            assessments, not a generic product tour.
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
