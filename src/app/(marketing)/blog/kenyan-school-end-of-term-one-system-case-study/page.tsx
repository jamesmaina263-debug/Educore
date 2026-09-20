import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";
import { TRIAL_HREF, TRIAL_CTA_SHORT } from "@/lib/marketing/trial";

// ---------------------------------------------------------------------------
// PUBLICATION GATE. This page renders a 404 until APPROVED is true.
//
// Everything below the quotes is the school's own written answers, supplied
// to EduCore on 2026-09-20 in response to four questions. They may only be
// published after the school approves IN WRITING: (a) the quotes exactly as
// they appear here, (b) the name/role attribution shown, and (c) use of the
// school's name (and logo, if shown). Flip APPROVED to true, and fill in the
// three constants below, only once that approval exists. If the school
// prefers anonymity, set SCHOOL_NAME to "a Kenyan school" and remove the
// role from ATTRIBUTION.
// ---------------------------------------------------------------------------
const APPROVED = false;
const SCHOOL_NAME = "[School name]";
const ATTRIBUTION = "[Name], [role], [School name]";
const PUBLISHED_ON = "2026-09-20"; // update to the actual go-live date on approval

const SLUG = "kenyan-school-end-of-term-one-system-case-study";
const PATH = `/blog/${SLUG}`;
const TITLE = "Case Study: A Kenyan School on Running End of Term From One System — EduCore";
const DESCRIPTION =
  "In its own words, a Kenyan school describes end of term before and after moving marks, fees and student records into one system, what surprised it, and what still needs improving.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  // Belt and braces while unapproved: never index a page that shouldn't exist yet.
  robots: APPROVED ? undefined : { index: false, follow: false },
};

// The school's answers, verbatim. Do not edit wording, trim, or "tidy" any
// sentence: the school's approval covers this exact text. Only the school can
// change these, by sending revised wording that we then re-confirm.
const SECTIONS = [
  {
    eyebrow: "Before",
    heading: "What end of term used to look like",
    paragraphs: [
      "Before EduCore, end of term was quite demanding for both the administration and teachers. A lot of work was done manually, especially compiling marks, checking fee balances, preparing reports and following up different records. This meant that teachers and office staff had to spend a lot of time moving between different records and confirming information.",
      "What pushed us to change was the need for a more organised system where student information, fees, academic records and other school activities could be managed from one platform. We wanted to reduce the amount of manual work and make it easier to access accurate information when needed.",
    ],
  },
  {
    eyebrow: "Fees",
    heading: "Reconciling M-Pesa payments",
    paragraphs: [
      "Previously, reconciling M-Pesa payments involved checking the M-Pesa records and then manually matching payments with individual students' accounts. This could take considerable time, especially when there were many payments coming in and some payments did not clearly indicate the student's details.",
      "With EduCore, the process is more organised because payments can be recorded against the student's account and the fee position can be viewed from the system. It is much easier to confirm what a student has paid, what remains outstanding and keep the fee records updated. It has reduced the amount of manual checking we have to do.",
    ],
  },
  {
    eyebrow: "Marks and reports",
    heading: "Entering marks and preparing report cards",
    paragraphs: [
      "Previously, entering marks and preparing reports involved a lot of paperwork and manual calculations. Teachers had to be very careful when transferring marks and preparing the final reports.",
      "With EduCore, marks can be entered directly into the system and the academic information is brought together in one place. This makes the process more organised and reduces repetitive work. It is also easier to review a student's performance and prepare the required report information without having to go through several physical records.",
      "For a teacher, the biggest difference is that the system saves time, particularly during the busy end-of-term period.",
    ],
  },
  {
    eyebrow: "Honest verdict",
    heading: "What surprised them, and what is still not perfect",
    paragraphs: [
      "What surprised us was how many different school activities can be brought together in one system. We initially looked at EduCore mainly from the perspective of managing student records and fees, but we have found that it can also support academic management, communication and other administrative processes.",
      "It is still a developing system, so there are areas that can be improved and we have shared some of our suggestions with the EduCore team. What we appreciate is that the team listens to feedback and makes improvements based on what schools actually need.",
      "Yes, we would recommend EduCore to another school, particularly a school that wants to reduce reliance on manual records and have better visibility of its day-to-day operations. However, we would advise any school to first understand its own needs and then see how the system fits those requirements.",
    ],
  },
];

export default function KenyanSchoolCaseStudyPost() {
  if (!APPROVED) notFound();

  return (
    <>
      <BreadcrumbJsonLd
        items={[HOME_CRUMB, { name: "Blog", path: "/blog" }, { name: "School case study", path: PATH }]}
      />
      <ArticleJsonLd headline={TITLE} description={DESCRIPTION} path={PATH} datePublished={PUBLISHED_ON} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Case Study</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          {SCHOOL_NAME} on running end of term from one system
        </h1>
        <BlogByline publishedOn={PUBLISHED_ON} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          We asked a school using EduCore four questions and are publishing
          the answers as they wrote them: what end of term used to involve,
          what changed for fees and report cards, and what is still not
          perfect.
        </p>
      </Section>

      {/* 2 — The school's own words */}
      {SECTIONS.map((s, i) => (
        <Section key={s.heading} tone={i % 2 === 0 ? "canvas" : "navy"}>
          <Reveal className="mx-auto max-w-3xl">
            <Eyebrow tone={i % 2 === 0 ? "light" : "dark"}>{s.eyebrow}</Eyebrow>
            <h2
              className={`mt-3 text-2xl font-semibold tracking-tight sm:text-3xl ${
                i % 2 === 0 ? "text-marketing-navy-950" : "text-white"
              }`}
            >
              {s.heading}
            </h2>
            <blockquote
              className={`mt-6 flex flex-col gap-4 border-l-2 border-marketing-gold-500 pl-5 text-base leading-relaxed ${
                i % 2 === 0 ? "text-marketing-navy-900/80" : "text-white/80"
              }`}
            >
              {s.paragraphs.map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
            </blockquote>
            <p className={`mt-3 text-xs ${i % 2 === 0 ? "text-marketing-navy-900/50" : "text-white/50"}`}>
              {ATTRIBUTION}
            </p>
          </Reveal>
        </Section>
      ))}

      {/* 3 — Context */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>About This Case Study</Eyebrow>
          <p className="mt-4 text-sm leading-relaxed text-marketing-navy-900/70">
            The answers above are the school&apos;s own, quoted exactly and
            published with its written approval. They describe one
            school&apos;s experience; results vary by school, and EduCore is
            not claiming a measured time saving. To see how the same areas
            work, read our guides to{" "}
            <Link
              href="/blog/mpesa-fee-collection-automation-kenya-schools"
              className="font-semibold text-marketing-navy-950 underline underline-offset-4"
            >
              M-Pesa fee collection
            </Link>{" "}
            and{" "}
            <Link
              href="/blog/student-performance-appraisal-kenya-schools"
              className="font-semibold text-marketing-navy-950 underline underline-offset-4"
            >
              student performance appraisal
            </Link>
            .
          </p>
        </Reveal>
      </Section>

      {/* 4 — CTA */}
      <Section tone="navy" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow tone="dark">Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Try it with your own school&apos;s data.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            Thirty days, no card, your own students and fee structure.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href={TRIAL_HREF}>
                {TRIAL_CTA_SHORT} <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline-on-dark">
              <Link href="/contact">Book a Demo</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
