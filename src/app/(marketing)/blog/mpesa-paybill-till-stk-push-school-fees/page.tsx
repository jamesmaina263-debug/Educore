import type { Metadata } from "next";
import Link from "next/link";
import { Smartphone, Receipt, Coins, ListChecks, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";
import { TRIAL_HREF, TRIAL_CTA_SHORT } from "@/lib/marketing/trial";

const SLUG = "mpesa-paybill-till-stk-push-school-fees";
const PATH = `/blog/${SLUG}`;
const PUBLISHED_ON = "2026-09-21";
const TITLE = "M-Pesa Paybill vs Till vs STK Push for School Fees in Kenya — EduCore";
const DESCRIPTION =
  "Paybill and Till are where school fees land. STK push is how a payment gets started. What each does, who pays the fee, how it affects reconciliation, and how a school should set them up.";
const STANDARD_ARTICLE =
  "https://www.standardmedia.co.ke/business/business/article/2001554316/safaricom-halves-m-pesa-merchant-fees-in-cbk-led-move";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Sourcing (researched Sep 2026):
//   - Till (Buy Goods) tariff: The Standard, "Safaricom halves M-Pesa merchant
//     fees in CBK-led move" (read in full): from 7 Aug 2026 the free
//     collection threshold on Buy Goods is KES 500 (up from 200); above that,
//     0.55% capped at KES 200. Customers pay nothing on Buy Goods (several
//     tariff guides agree). Older guides still say 0.5% / KES 200 free; this
//     post follows the most recent report and tells readers to confirm on
//     Safaricom's tariff page. The 30,000 example is 0.55% x 30,000 = 165.
//   - Paybill: the fee depends on the tariff the business chose (customer
//     pays, business pays, or shared). Exact customer bands are NOT quoted
//     because sources disagree and they change.
//   - Till has no account-number field; Paybill does (tariff guides).
//   - STK push / Daraja: prompt on the customer's phone, PIN entry, phone must
//     be on and unlocked; requires an existing Paybill or Till, a Daraja
//     account, and Go Live approval yielding production consumer key/secret,
//     shortcode and passkey; live HTTPS callback URLs; guides put approval at
//     roughly 2-10 business days. Third-party guides, consistent with each
//     other; not read from Safaricom's own docs.
// EduCore statements were checked in the repo (Sep 2026):
//   - Each school uses its own Paybill/Till and its own Daraja app
//     (_shared/mpesa/daraja.ts); STK push supports both shortcode types
//     (CustomerPayBillOnline / CustomerBuyGoodsOnline); credentials are
//     encrypted via Supabase Vault.
//   - The push trigger sits on Finance > Student Accounts, Invoices and the
//     Admissions wizard's Finance step, and takes the amount and phone number
//     from the form in front of the user. It is user-initiated, NOT a bulk
//     arrears sender -- do not describe it as one.
//   - Confirmation arrives via Safaricom's callback (mpesa-stk-callback).
//   - Statement reconciliation matches uploaded/pasted lines by receipt number
//     and flags "not in system" lines for the bursar to record.
//   - There is NO C2B real-time registration in the repo, so a payment a
//     parent makes directly to the Paybill/Till is picked up when the
//     statement is uploaded, not instantly. The post says so.
//   - The student payment reference is a short static {PREFIX}{SEQ} code.

const FAQS = [
  {
    q: "Is STK push different from Paybill?",
    a: "Yes. Paybill is an account number where the school receives money. STK push is a way of starting a payment: the school's system sends a prompt to the parent's phone, and the parent enters their PIN. STK push works with either a Paybill or a Till.",
  },
  {
    q: "Do parents pay a fee when they pay by STK push?",
    a: "A payment made through STK push lands on your Paybill or Till like any other, so the tariff attached to that Paybill or Till generally applies. On a Till the parent pays nothing. On a Paybill it depends on the tariff the school chose. Confirm your own tariff with Safaricom.",
  },
  {
    q: "Which should a school choose, a Paybill or a Till?",
    a: "If matching payments to students matters most, and it usually does, a Paybill with a short student reference as the account number is easier to work with. A Till costs the parent nothing but costs the school a small percentage, and it gives you no account-number field, so identification is harder unless payments start from the school's own system.",
  },
  {
    q: "Do we need a developer to use STK push?",
    a: "Someone has to complete Safaricom's Daraja go-live process for your Paybill or Till and obtain the production credentials. After that, a school system that supports STK push does the technical part. The go-live application needs your registered business details, and Safaricom's review time varies.",
  },
  {
    q: "What about collecting through a bank's paybill instead?",
    a: "Some schools collect through a bank's own paybill, with the money landing in the school's bank account. That is a different arrangement: charges, account formats and statements come from the bank, and whether STK push is available depends on the bank. It is outside what this guide compares.",
  },
];

const CHOICES = [
  {
    icon: Receipt,
    name: "Paybill",
    lines: [
      ["Parent enters", "The Paybill number, an account number (the student's reference), and the amount."],
      ["Who pays the fee", "Set by the tariff the business chose: the parent, the school, or shared. Check yours."],
      ["Identifying the student", "The account number field arrives with the payment, so each one already says who it is for."],
      ["Watch out for", "Typos in the account number, and parents who pay without it."],
    ],
  },
  {
    icon: Coins,
    name: "Till (Buy Goods)",
    lines: [
      ["Parent enters", "The Till number and the amount. There is no account-number field."],
      ["Who pays the fee", "The parent pays nothing. The school pays a small percentage on each collection."],
      ["Identifying the student", "Nothing on the payment says which student it is for, only the payer's phone and name."],
      ["Watch out for", "Matching becomes detective work when several parents pay the same amount."],
    ],
  },
];

const SETUP_STEPS = [
  {
    q: "Decide which account receives the money",
    a: "Paybill if matching payments to students is your main pain, which it usually is for a school. Till if you mostly want zero cost to parents and can start payments from your own system.",
  },
  {
    q: "Choose who bears the fee, on purpose",
    a: "Parents notice a fee added to a school payment. Whichever tariff you pick, decide it deliberately and tell parents, instead of discovering it at the first complaint.",
  },
  {
    q: "Give every student a short, permanent reference",
    a: "Something a parent can type from memory, with no slashes or dates. If it changes every term, parents will type the old one.",
  },
  {
    q: "Apply for Daraja access if you want STK push",
    a: "You need an active Paybill or Till first. The go-live application asks for your business details and live HTTPS callback URLs, and incomplete paperwork is a common reason for rejection.",
  },
  {
    q: "Agree a reconciliation routine",
    a: "Compare Safaricom's statement with your records on a set day each week, and every day near the start of term. Payments made directly to the Paybill or Till will only show up this way.",
  },
];

export default function MpesaPaybillTillStkPushSchoolFeesPost() {
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
        items={[HOME_CRUMB, { name: "Blog", path: "/blog" }, { name: "Paybill vs Till vs STK Push", path: PATH }]}
      />
      <ArticleJsonLd headline={TITLE} description={DESCRIPTION} path={PATH} datePublished={PUBLISHED_ON} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          M-Pesa Paybill vs Till vs STK Push for School Fees in Kenya
        </h1>
        <BlogByline publishedOn={PUBLISHED_ON} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Schools often treat these as three competing options. They are
          not. Two of them are places where fees land, and the third is a
          way of starting a payment. Getting that straight makes the choice
          much easier, and often explains why reconciliation is harder than it
          needs to be.
        </p>
      </Section>

      {/* 2 — Two questions */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Key Distinction</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Two separate questions
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              <strong className="font-semibold text-marketing-navy-950">Where does the money land?</strong>{" "}
              That is a Paybill or a Till. It decides what a parent has to
              type, who pays the transaction fee, and how easily you can tell
              whose money it is.
            </p>
            <p>
              <strong className="font-semibold text-marketing-navy-950">How does the payment start?</strong>{" "}
              Either the parent starts it by opening M-Pesa and typing your
              number, or your school&apos;s system starts it with an STK push,
              the PIN prompt that appears on the parent&apos;s phone. STK push
              works with either a Paybill or a Till.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — Paybill vs Till */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">Where The Money Lands</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Paybill vs Till, for a school
          </h2>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-5xl gap-10 md:grid-cols-2">
          {CHOICES.map((c) => (
            <Reveal key={c.name}>
              <c.icon className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
              <p className="mt-3 text-lg font-semibold text-white">{c.name}</p>
              <dl className="mt-4 flex flex-col gap-4">
                {c.lines.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-white/50">{k}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-white/75">{v}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          ))}
        </div>
        <Reveal className="mx-auto mt-12 max-w-3xl">
          <p className="text-sm leading-relaxed text-white/70">
            <strong className="font-semibold text-white">On the numbers.</strong>{" "}
            As reported by{" "}
            <a
              href={STANDARD_ARTICLE}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-marketing-gold-400 underline underline-offset-4"
            >
              The Standard
            </a>
            , from 7 August 2026 a Till collection of up to KES 500 is free
            for the business, and above that the fee is 0.55%, capped at
            KES 200. On a KES 30,000 term payment that is about KES 165. From
            about KES 36,400 upward, it is the KES 200 cap.
            Paybill charges depend on the tariff you selected and are not
            quoted here because they change. Tariffs are updated, so confirm
            the current figures with Safaricom before you decide.
          </p>
        </Reveal>
      </Section>

      {/* 4 — STK push */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Starting The Payment</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            What STK push adds, and what it does not
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              With an STK push, your system sends the request through
              Safaricom&apos;s Daraja API, a prompt appears on the
              parent&apos;s phone with the amount already filled in, and the
              parent enters their PIN. Because the request came from your
              system, it already knows which student it was for, so
              there is no account number to mistype, and confirmation
              arrives automatically.
            </p>
            <p>
              What it needs: an existing Paybill or Till, a Daraja developer
              account, and Safaricom&apos;s go-live approval, which returns
              your production credentials. Guides put approval at roughly
              two to ten business days, and incomplete business paperwork or
              invalid callback addresses are common reasons for rejection.
            </p>
            <p>
              What it does not do: make the fee on your Paybill or Till go away, or reach a parent whose
              phone is off, locked or offline. It also does not catch payments
              a parent makes on their own straight to your Paybill or Till.
              Those still need reconciling from the statement.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 5 — Setup steps */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Setting It Up</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Five decisions, in order
          </h2>
          <ol className="mt-8 flex flex-col gap-6">
            {SETUP_STEPS.map((s, i) => (
              <li key={s.q} className="flex gap-4">
                <span className="mt-0.5 font-mono text-sm text-marketing-gold-400">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="text-base font-semibold text-white">{s.q}</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">{s.a}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm leading-relaxed text-white/60">
            If you contact parents about arrears, message the parent or
            guardian of that child only. Our{" "}
            <Link
              href="/blog/data-protection-act-kenya-schools-guide"
              className="font-semibold text-marketing-gold-400 underline underline-offset-4"
            >
              Data Protection Act guide for schools
            </Link>{" "}
            covers why fee balances should never go to a group chat.
          </p>
        </Reveal>
      </Section>

      {/* 6 — EduCore */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-marketing-gold-600" strokeWidth={1.75} />
            <Eyebrow>How EduCore Handles It</Eyebrow>
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            What we support, and where the manual step is
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              Each school connects its own Paybill or Till and its own Daraja
              credentials, so the money goes straight to your account and
              never through ours. EduCore supports STK push for both a Paybill
              and a Till, and the credentials are stored encrypted.
            </p>
            <p>
              A bursar starts an STK push from the student&apos;s account, an
              invoice, or the admissions finance step, where the amount and
              the parent&apos;s phone number are already on screen. The payment
              is confirmed automatically when Safaricom&apos;s callback
              arrives. For payments that parents make directly to your Paybill
              or Till, you upload Safaricom&apos;s statement in Finance and every
              line is matched by M-Pesa receipt number. Anything on the
              statement that isn&apos;t in the system is flagged for the bursar
              to record, and nothing is added to a student&apos;s account
              without a person confirming it.
            </p>
            <p>
              The honest limit: EduCore does not record a payment a parent
              makes directly to your Paybill or Till instantly. It is picked
              up when you upload the statement, so a daily or weekly upload
              routine matters. For the fuller picture, read{" "}
              <Link
                href="/blog/mpesa-fee-collection-automation-kenya-schools"
                className="font-semibold text-marketing-navy-950 underline underline-offset-4"
              >
                how M-Pesa fee collection works in EduCore
              </Link>
              .
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
          <div className="mt-8 flex items-start gap-3 text-xs leading-relaxed text-white/50">
            <ListChecks className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <p>
              Safaricom tariffs and Daraja procedures change. This guide
              reflects publicly reported information as of September 2026 and
              is not affiliated with or endorsed by Safaricom. Confirm current
              charges and requirements with Safaricom before deciding.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 8 — CTA */}
      <Section tone="canvas" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow>Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Try it with your own Paybill or Till.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
            Thirty days, no card. Run a real statement through reconciliation
            before you decide.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href={TRIAL_HREF}>
                {TRIAL_CTA_SHORT} <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/contact">Book a Demo</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
