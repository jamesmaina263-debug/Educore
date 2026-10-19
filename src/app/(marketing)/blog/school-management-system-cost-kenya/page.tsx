import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Receipt, MessageSquareText, GraduationCap, Download } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";
import { TRIAL_HREF, TRIAL_CTA_SHORT } from "@/lib/marketing/trial";
import { RelatedGuides } from "@/components/marketing/related-guides";

const SLUG = "school-management-system-cost-kenya";
const PATH = `/blog/${SLUG}`;
const PUBLISHED_ON = "2026-10-19";
const TITLE = "How Much Does a School Management System Cost in Kenya? (2026) — EduCore";
const DESCRIPTION =
  "How Kenyan school management systems are priced, what a 150, 300 and 600-student school would pay at KES 100 per student per term, and the extra costs to ask about before you sign.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH, images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

// Claims about EduCore below were checked against the repo before writing:
//   - Pricing: a flat KES 100 per enrolled student per term on every plan,
//     published as "from"/"starting at"; 150 students = about KES 15,000 per
//     term (src/app/(marketing)/pricing/page.tsx). The 300 and 600-student rows
//     and the per-year figures are plain arithmetic on that rate (x3 terms),
//     and are labelled as base-rate figures, not quotes.
//   - Plans: Starter up to 200 students (core records, Academics, Finance &
//     Fees); Growth up to 800 (adds Payroll, Library, Transport, Boarding,
//     Inventory & Procurement, Communication); Enterprise has no cap and is a
//     sales conversation. So the 300 and 600-student examples sit on Growth.
//   - Add-ons: the pricing page only says they are confirmed in one
//     conversation. This post says exactly that and quotes no add-on price.
//   - Trial: 30 days, no card (src/lib/marketing/trial.ts). Nothing claimed
//     about data after the trial.
//   - Data export: Settings > Data export, owner/principal only, one Excel
//     workbook (see the free-school-management-system-kenya post).
// Statements about other vendors' models describe patterns in general; no
// competitor is named, and no market-wide price range is claimed because we
// have no verified source for one.

const SIZES = [
  { students: 150, plan: "Starter", term: "KES 15,000", year: "KES 45,000" },
  { students: 300, plan: "Growth", term: "KES 30,000", year: "KES 90,000" },
  { students: 600, plan: "Growth", term: "KES 60,000", year: "KES 180,000" },
];

const FAQS = [
  {
    q: "How much does a school management system cost in Kenya?",
    a: "It depends on the pricing model. Common ones are a price per student per term, a yearly licence, a one-off fee plus support, or a quote only after a call. EduCore starts from KES 100 per enrolled student, per term, at the same base rate on every plan, so a 150-student school would start from about KES 15,000 per term.",
  },
  {
    q: "Is per-student pricing cheaper than a flat licence?",
    a: "Not automatically. Per-student pricing follows your enrolment, so it is lower in a small year and higher in a big one. A flat licence is easier to predict but can overcharge a small school or cap a growing one. Work out both for your own student numbers and compare the yearly total.",
  },
  {
    q: "What costs extra besides the subscription?",
    a: "Ask about SMS and WhatsApp messaging, payment processing, onboarding and data import, training, paid support tiers and data export. At EduCore, add-ons are confirmed with you up front in one conversation, so there are no surprises on the first invoice.",
  },
  {
    q: "How is EduCore billed?",
    a: "By the term, to match the school calendar, and against the students you actually have enrolled. Every school starts with a 30-day free trial, no card required.",
  },
  {
    q: "Can a small school afford it?",
    a: "At the base rate a 150-student school starts from about KES 15,000 per term. Check that against what you lose today to unreconciled fee balances, lost paper records and staff time at the end of term. The trial lets you test the system against your own books before you pay anything.",
  },
];

const QUESTIONS = [
  {
    q: "Is the price per student, per year, or a one-off fee?",
    a: "Get the unit and the billing period in writing, then convert it to a yearly figure for your own enrolment. Without that, two quotes cannot be compared.",
  },
  {
    q: "Which modules are in that price?",
    a: "Finance and academics are usually in. Payroll, boarding, transport, library and parent messaging are often priced separately. List the modules your school uses and ask for each.",
  },
  {
    q: "Who pays for SMS and payment processing?",
    a: "Every school that messages parents pays for messages somewhere. Find out the per-unit price, who sets it, and whether it is in the quote.",
  },
  {
    q: "What does setup and data import cost?",
    a: "Moving your existing student list and fee balances in is where many rollouts stall. Ask whether import is self-serve, paid, or done for you.",
  },
  {
    q: "What happens to the price as you grow?",
    a: "Check whether crossing a student number changes the rate or forces a plan change, and how much notice you get of any increase.",
  },
  {
    q: "Can you take your data with you?",
    a: "The cheapest system is no bargain if leaving costs a term. Export your records during the trial and open the file.",
  },
];

export default function SchoolManagementSystemCostKenyaPost() {
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
          { name: "School Management System Cost in Kenya", path: PATH },
        ]}
      />
      <ArticleJsonLd headline={TITLE} description={DESCRIPTION} path={PATH} datePublished={PUBLISHED_ON} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero + short answer */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="light">Pricing Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          How Much Does a School Management System Cost in Kenya?
        </h1>
        <BlogByline publishedOn={PUBLISHED_ON} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          The short answer: it depends on how the vendor charges, and the
          sticker price is rarely the whole bill. EduCore starts from KES 100
          per enrolled student, per term, so a 150-student school would start
          from about KES 15,000 a term. Here is how to work out the real
          number for your school, and what to ask before you sign anything.
        </p>
      </Section>

      {/* 2 — Pricing models */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Models</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Four ways school systems are priced
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              <strong className="font-semibold text-marketing-navy-950">Per student, per term.</strong>{" "}
              You pay for the learners you have enrolled, on the same
              calendar the school bills parents. The cost rises and falls
              with enrolment, which makes it easy to budget termly.
            </p>
            <p>
              <strong className="font-semibold text-marketing-navy-950">A yearly licence.</strong>{" "}
              One annual figure, often by school size band. Predictable, but
              you pay the same in a thin year as in a full one.
            </p>
            <p>
              <strong className="font-semibold text-marketing-navy-950">A one-off fee plus support.</strong>{" "}
              A large payment up front, then a yearly support charge. Check
              what the support covers and what upgrades cost.
            </p>
            <p>
              <strong className="font-semibold text-marketing-navy-950">&quot;Contact us for a quote.&quot;</strong>{" "}
              Nothing published, so you cannot compare until you have spent
              time on a sales call. Not wrong, just slower.
            </p>
            <p>
              Whichever model a vendor uses, convert it to a yearly total for
              your own enrolment. That is the only number you can compare.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — Worked example */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Worked Example</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            What three school sizes pay at the EduCore base rate
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            The base rate is KES 100 per enrolled student, per term, and it is
            the same on every plan. Plans differ by which modules they include.
            A year is three terms.
          </p>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm text-white/80">
              <thead>
                <tr className="border-b border-white/15 text-xs uppercase tracking-[0.12em] text-white/50">
                  <th className="py-3 pr-4 font-medium">Enrolled students</th>
                  <th className="py-3 pr-4 font-medium">Fits plan</th>
                  <th className="py-3 pr-4 font-medium">Per term, from</th>
                  <th className="py-3 font-medium">Per year, from</th>
                </tr>
              </thead>
              <tbody>
                {SIZES.map((s) => (
                  <tr key={s.students} className="border-b border-white/10">
                    <td className="py-3 pr-4 font-semibold text-white">{s.students}</td>
                    <td className="py-3 pr-4">{s.plan}</td>
                    <td className="py-3 pr-4">{s.term}</td>
                    <td className="py-3">{s.year}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            These are base-rate figures, not a quote. Starter covers up to 200
            students and Growth up to 800; Enterprise has no cap and is arranged
            with our team. Any add-ons are confirmed with you up front.
          </p>
        </Reveal>
      </Section>

      {/* 4 — Hidden costs */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Read The Small Print</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            The costs outside the subscription
          </h2>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
          <Reveal>
            <MessageSquareText className="h-5 w-5 text-marketing-gold-600" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-marketing-navy-950">Messaging</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
              Fee reminders, attendance alerts and report-card notices across a
              whole school add up. Someone pays per message. Know who, and at
              what rate.
            </p>
          </Reveal>
          <Reveal>
            <Receipt className="h-5 w-5 text-marketing-gold-600" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-marketing-navy-950">Payments and add-ons</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
              Payment processing, extra modules and premium onboarding are the
              usual line items that sit outside the headline price.
            </p>
          </Reveal>
          <Reveal>
            <GraduationCap className="h-5 w-5 text-marketing-gold-600" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-marketing-navy-950">Setup and training</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
              Importing your students and fee balances, and teaching staff to
              use the system, is real work. Ask whether it is included, paid,
              or left to you.
            </p>
          </Reveal>
          <Reveal>
            <Download className="h-5 w-5 text-marketing-gold-600" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-marketing-navy-950">Getting out</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
              The biggest cost of any system is switching away from it. What
              you can export decides whether that takes a weekend or a term.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* 5 — Questions to ask */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Before You Sign</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Six questions that make any two quotes comparable
          </h2>
          <ol className="mt-8 flex flex-col gap-6">
            {QUESTIONS.map((c, i) => (
              <li key={c.q} className="flex gap-4">
                <span className="mt-0.5 font-mono text-sm text-marketing-gold-500">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="text-base font-semibold text-white">{c.q}</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">{c.a}</p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
      </Section>

      {/* 6 — Cost against payoff */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Is It Worth It</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Test the price against your own books
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              A system pays for itself if it saves more than it costs, and you
              can check that for your own school instead of trusting a
              brochure. Take a 300-student school: the base rate is about KES
              30,000 a term. Now look at last term. How much fee money was
              received but not matched to the right child? How many staff
              hours went on reconciling it and chasing balances?
            </p>
            <p>
              If those two numbers together are close to KES 30,000, the
              subscription is already a wash before you count anything else.
              Our guides on{" "}
              <Link
                href="/blog/mpesa-fee-collection-automation-kenya-schools"
                className="font-semibold text-marketing-navy-950 underline underline-offset-4"
              >
                M-Pesa fee collection
              </Link>{" "}
              and on{" "}
              <Link
                href="/blog/free-school-management-system-kenya"
                className="font-semibold text-marketing-navy-950 underline underline-offset-4"
              >
                what &quot;free&quot; software really covers
              </Link>{" "}
              go deeper on where the savings and the costs tend to sit.
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
        </Reveal>
      </Section>

      {/* 8 — CTA */}
      <Section tone="canvas" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow>Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-marketing-navy-950 sm:text-4xl">
            See your own number before you pay anything.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
            Thirty days, no card, your own students and fee structure.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href={TRIAL_HREF}>
                {TRIAL_CTA_SHORT} <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/pricing">See Pricing</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
      <RelatedGuides slug="school-management-system-cost-kenya" />
    </>
  );
}
