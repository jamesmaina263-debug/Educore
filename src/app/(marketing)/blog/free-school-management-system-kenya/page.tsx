import type { Metadata } from "next";
import Link from "next/link";
import { Coins, MessageSquareText, Download, LifeBuoy, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";
import { TRIAL_HREF, TRIAL_CTA_SHORT } from "@/lib/marketing/trial";

const SLUG = "free-school-management-system-kenya";
const PATH = `/blog/${SLUG}`;
const PUBLISHED_ON = "2026-09-20";
const TITLE = "Free School Management Software in Kenya: What \"Free\" Actually Covers — EduCore";
const DESCRIPTION = "Free platforms, open-source editions, and capped free tiers all get called free. Where the real costs show up, and when free is the right call.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Claims about EduCore below were checked against the repo before writing:
//   - Pricing: a flat KES 100 per student per term across all tiers, and the
//     "150-student school = about KES 15,000 per term" example -- both taken
//     from src/app/(marketing)/pricing/page.tsx (which reads from the live
//     subscription_plans table). Add-ons are described there only as
//     "confirmed in one conversation", so this post says exactly that and
//     nothing more specific about SMS/WhatsApp pass-through costs.
//   - Trial: 30 days, no card, sign-in pauses until a plan is agreed
//     (src/lib/marketing/trial.ts). Deliberately NOT claiming anything about
//     what happens to data after the trial -- that file's own comment says
//     copy should not.
//   - Data export: Settings > Data export, owner/principal only, one Excel
//     workbook with Students, Guardians, Staff, academic structure (Years,
//     Terms, Classes, Streams, Subjects), Invoices and Payments
//     (src/components/settings/data-export-panel.tsx). Module-specific
//     exports (attendance, marks) live in their own modules.
//   - Data import: template-driven Excel import
//     (src/components/settings/data-import-panel.tsx).
// Statements about "free" models in general describe patterns Kenyan
// vendors publicly use; no specific competitor is named or characterised.

const FAQS = [
  {
    q: "Is free school management software in Kenya any good?",
    a: "Some of it is, and for a small school with simple needs it can be the right choice. The useful question isn't free versus paid, it's what is actually included in the free part, who pays for the things every school ends up needing (parent SMS, payment processing, support), and whether you can leave with your data.",
  },
  {
    q: "What are the hidden costs of free school software?",
    a: "Rarely hidden, but often not on the front page: per-message SMS charges, payment-processing fees, paid onboarding or data migration, paid support tiers, and — for self-hosted open-source editions — the server and the person who maintains it. Ask for each one in writing before you decide.",
  },
  {
    q: "How much does EduCore cost?",
    a: "From KES 100 per enrolled student, per term, at the same base rate on every plan; tiers differ by which modules are included. A 150-student school would start from about KES 15,000 per term. Any add-ons are confirmed with you up front, and every school starts with a 30-day free trial with no card required.",
  },
  {
    q: "Can I take my school's data with me if I stop using EduCore?",
    a: "Yes. The school owner or principal can export one Excel workbook containing Students, Guardians, Staff, the academic structure (years, terms, classes, streams, subjects), Invoices and Payments from Settings. Module-specific reports such as attendance and exam marks have their own exports inside each module.",
  },
];

const CHECKLIST = [
  {
    q: "What exactly is in the free part?",
    a: "Get the list, module by module. \"Free\" often covers student records and attendance while fee reconciliation, payroll, CBC report cards or the parent app sit in a paid tier or an add-on.",
  },
  {
    q: "Who pays for parent SMS and payment processing?",
    a: "Every school that messages parents pays for SMS somewhere, whether in the licence, as credits, or per message. Find out the per-unit price and who sets it.",
  },
  {
    q: "Can you export everything, in a usable format, today?",
    a: "Don't take the answer on trust. During the trial, export your data and open it. If you can't get students, guardians, fees and payments out as a spreadsheet, you can't leave.",
  },
  {
    q: "How does it handle M-Pesa, honestly?",
    a: "\"M-Pesa integrated\" can mean anything from automatic STK-push confirmation to a note saying which paybill to use. Ask a bursar to run a real Paybill statement through it.",
  },
  {
    q: "Who answers when report cards are due?",
    a: "Support hours matter most in the last week of term. Find out who picks up the phone or WhatsApp then, and whether that is part of the price.",
  },
  {
    q: "How do you get your existing records in?",
    a: "Migration from Excel is where most rollouts stall. Ask whether import is self-serve, paid, or done for you, and try it on one real class list.",
  },
  {
    q: "What happens if the pricing or the vendor changes?",
    a: "A free tier is a business decision the vendor can revisit. Your protection is a working export and a system you could replace in a term, not a promise.",
  },
];

export default function FreeSchoolManagementSystemKenyaPost() {
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
          { name: "What \"Free\" School Software Covers", path: PATH },
        ]}
      />
      <ArticleJsonLd headline={TITLE} description={DESCRIPTION} path={PATH} datePublished={PUBLISHED_ON} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Free School Management Software in Kenya: What &quot;Free&quot; Actually Covers
        </h1>
        <BlogByline publishedOn={PUBLISHED_ON} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Several good Kenyan school systems cost nothing to start, and for
          some schools that is exactly the right answer. But
          &quot;free&quot; is doing a lot of work in that sentence. Here is
          what it can mean, where the costs tend to appear, and seven
          questions that let you compare any two options fairly, including
          ours.
        </p>
      </Section>

      {/* 2 — Four meanings of free */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Term Is Slippery</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Four different things get called &quot;free&quot;
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              <strong className="font-semibold text-marketing-navy-950">A free core, with paid extras.</strong>{" "}
              Student records, attendance and exams cost nothing; SMS,
              payment processing, onboarding or add-ons are charged
              separately. You pay for whatever your school ends up using.
            </p>
            <p>
              <strong className="font-semibold text-marketing-navy-950">A free open-source edition.</strong>{" "}
              The software costs nothing to download. Hosting, setup,
              upgrades and someone to fix it are yours, or a paid service.
            </p>
            <p>
              <strong className="font-semibold text-marketing-navy-950">A free tier with a student cap.</strong>{" "}
              Free below a certain enrolment, paid above it, so the cost
              arrives when the school grows.
            </p>
            <p>
              <strong className="font-semibold text-marketing-navy-950">A free trial.</strong>{" "}
              Everything works for a while, then you pay or stop. This one
              is honest about being temporary, which is its virtue.
            </p>
            <p>
              Kenyan vendors use all four, and each is a legitimate way to
              sell software. The point is that they answer &quot;what will
              this cost my school next year?&quot; very differently.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — Where costs show up */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">Follow The Money</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Where the real costs tend to appear
          </h2>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
          <Reveal>
            <MessageSquareText className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Parent messaging</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Fee reminders, attendance alerts and report-card notices add
              up fast across a whole school. Someone pays per message; it is
              worth knowing who, and at what rate.
            </p>
          </Reveal>
          <Reveal>
            <Coins className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Payments and add-ons</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Payment processing, extra modules and premium onboarding are
              the usual line items outside a free core.
            </p>
          </Reveal>
          <Reveal>
            <LifeBuoy className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Support and staff time</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Free support is only as good as its response time in the week
              reports are due. Self-hosting shifts that cost onto your own
              IT person, if you have one.
            </p>
          </Reveal>
          <Reveal>
            <Download className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Getting out</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              The biggest cost of any system is switching away from it.
              What you can export decides whether that is a weekend or a
              term.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* 4 — Checklist */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Checklist</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Seven questions to ask any vendor, free or paid
          </h2>
          <ol className="mt-8 flex flex-col gap-6">
            {CHECKLIST.map((c, i) => (
              <li key={c.q} className="flex gap-4">
                <span className="mt-0.5 font-mono text-sm text-marketing-gold-600">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="text-base font-semibold text-marketing-navy-950">{c.q}</p>
                  <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">{c.a}</p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
      </Section>

      {/* 5 — When free is right */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Being Straight About It</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            When free is the right call
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              If you run a small school, your needs are mostly records,
              attendance and simple report cards, and money is tight, a free
              system is a sensible place to start. You lose little by
              trying one.
            </p>
            <p>
              Paid tends to earn its keep when finance is the pain: real
              M-Pesa reconciliation, arrears tracking, payroll, several
              modules that have to agree with each other, and support you can
              count on at term end. If that is your school, compare on the
              seven questions above rather than on price alone.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 6 — How EduCore answers */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Our Answers</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            How EduCore answers those questions
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              EduCore is paid, and we would rather say so plainly. Pricing
              starts from KES 100 per enrolled student, per term, at the
              same base rate on every plan; the plans differ by which
              modules are included. A 150-student school starts from about
              KES 15,000 a term. Add-ons are confirmed with you up front, on
              the{" "}
              <Link href="/pricing" className="font-semibold text-marketing-navy-950 underline underline-offset-4">
                pricing page
              </Link>{" "}
              or in a demo.
            </p>
            <p>
              Every school starts with a 30-day free trial and no card. Try
              the things on the checklist during it: run a real Paybill
              statement, import one class list, and use the data export to
              open your school&apos;s records as an Excel workbook. The school owner or principal can export
              Students, Guardians, Staff, the academic structure, Invoices
              and Payments in one file, so leaving is possible.
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
            Test it with your own data before you decide.
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
    </>
  );
}
