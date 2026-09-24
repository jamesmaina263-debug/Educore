import type { Metadata } from "next";
import Link from "next/link";
import { Landmark, PiggyBank, HeartPulse, Building2, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";
import { TRIAL_HREF, TRIAL_CTA_SHORT } from "@/lib/marketing/trial";

const SLUG = "school-payroll-statutory-deductions-kenya";
const PATH = `/blog/${SLUG}`;
const PUBLISHED_ON = "2026-09-21";
const TITLE = "School Payroll in Kenya: PAYE, SHIF, NSSF and the Housing Levy Explained (2026) — EduCore";
const DESCRIPTION =
  "The four statutory deductions on a Kenyan school payslip in 2026: what each is, the rates after the February 2026 NSSF change, the order they are applied in, a worked example, deadlines, and common mistakes.";
const KRA_NOTICE =
  "https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH, images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

// Sourcing (researched Sep 2026):
//   - Order of deductions and deductibility: KRA public notice on the Tax Laws
//     (Amendment) Act 2024 (effective 27 Dec 2024), read via search result:
//     the Affordable Housing Levy and SHIF contributions are deductible in
//     determining taxable employment income, and the Affordable Housing Relief
//     ceased. One tax-calculator site claims AHL is deducted after PAYE; that
//     contradicts the KRA notice and was disregarded.
//   - PAYE bands (10% to 24,000; 25% to 32,333; 30% to 500,000; 32.5% to
//     800,000; 35% above) and personal relief KES 2,400/month: consistent
//     across guides; a July 2026 employer bulletin (CRS) reports the Finance
//     Act 2026 (assented 26 June 2026) did not amend bands or personal reliefs.
//     A proposed PAYE cut discussed earlier in 2026 was not enacted.
//   - NSSF from Feb 2026: lower limit 9,000, upper limit 108,000, 6% each side,
//     max KES 6,480 each: consistent across several guides.
//   - SHIF: 2.75% of gross, minimum KES 300, replaced NHIF from Oct 2024.
//   - AHL: 1.5% employee + 1.5% employer.
//   - Deadlines: most 2026 guides say PAYE, SHIF, the Housing Levy and NSSF are
//     all due by the 9th of the following month. The NSSF date is hedged in the
//     copy because the NSSF Act historically used the 15th.
//   - The KES 50,000 example was computed with the same formula EduCore's
//     payroll uses (supabase/migrations/20260802102732_payroll_calc_functions.sql
//     and the 2026-02-01 rate row) and matches a published worked example to
//     within KES 0.30 (that source starts band 3 one shilling late).
// EduCore statements were checked in the repo:
//   - Computes NSSF (employee share), SHIF, Housing Levy and PAYE with the
//     KES 2,400 personal relief from a rates table with effective dates;
//     taxable pay = gross - NSSF - SHIF - AHL. Rates are maintained centrally
//     (only the platform super-admin can change them), not edited per school.
//   - Payroll runs go draft -> approved (separate payroll.approve permission)
//     -> paid; an approved/paid record cannot be regenerated.
//   - Payslip PDF shows employer KRA PIN and the staff member's KRA PIN /
//     NSSF / SHIF numbers where set; itemised "other deductions".
//   - NOT built: KRA/NSSF/SHA filing or remittance, employer-side cost lines,
//     insurance/mortgage/pension relief, NITA. The copy says so. The rate
//     row's own source note tells users to verify with a tax professional.

const FAQS = [
  {
    q: "Does the school also pay NSSF and the Housing Levy?",
    a: "Yes. Both are matched by the employer. The employer pays 6% NSSF on pensionable pay up to the KES 108,000 limit (up to KES 6,480 per person per month from February 2026) and 1.5% of gross for the Housing Levy, on top of the employee's own deductions. These are a cost to the school, not something taken from the staff member's pay.",
  },
  {
    q: "What replaced NHIF?",
    a: "The Social Health Insurance Fund (SHIF), collected by the Social Health Authority, replaced NHIF from October 2024. It is 2.75% of gross pay with a minimum of KES 300, with no bands and no upper cap.",
  },
  {
    q: "Are SHIF and the Housing Levy taken off before PAYE is calculated?",
    a: "Yes. Under KRA's notice on the Tax Laws (Amendment) Act 2024, effective 27 December 2024, contributions to SHIF and the Affordable Housing Levy are deductible in arriving at taxable pay, alongside NSSF. Guides written before that date still show the old order.",
  },
  {
    q: "Do teachers employed by the TSC go on our school payroll?",
    a: "Generally not. Teachers employed by the Teachers Service Commission are paid and taxed through TSC. This guide is for staff your school or its owner or board employs directly, for example private-school staff and non-teaching staff on a board or owner payroll.",
  },
  {
    q: "Did the Finance Act 2026 change PAYE?",
    a: "According to an employer bulletin published shortly after the Act was assented to on 26 June 2026, it did not change the PAYE bands, personal income tax rates or personal reliefs. A proposed cut for lower earners that had been discussed earlier in 2026 was not enacted. Check KRA's current notices before each year-end.",
  },
];

const DEDUCTIONS = [
  {
    icon: PiggyBank,
    name: "NSSF",
    lines: [
      ["Employee", "6% of pensionable pay up to KES 108,000 (from February 2026)"],
      ["Employer", "Matches the employee's 6%"],
      ["Maximum", "KES 6,480 each per month"],
      ["What changed", "In February 2026 the lower limit rose to KES 9,000 and the upper limit to KES 108,000, lifting the maximum from KES 4,320 to KES 6,480."],
    ],
  },
  {
    icon: HeartPulse,
    name: "SHIF",
    lines: [
      ["Employee", "2.75% of gross pay, minimum KES 300"],
      ["Employer", "Deducts and remits it; no employer match"],
      ["Maximum", "None"],
      ["What changed", "SHIF replaced NHIF from October 2024. NHIF's salary bands no longer apply."],
    ],
  },
  {
    icon: Building2,
    name: "Housing Levy",
    lines: [
      ["Employee", "1.5% of gross pay"],
      ["Employer", "Matches the employee's 1.5%"],
      ["Maximum", "None"],
      ["What changed", "Since December 2024 it is deducted before PAYE is worked out, and the separate 15% housing relief has ended."],
    ],
  },
  {
    icon: Landmark,
    name: "PAYE",
    lines: [
      ["Employee", "10% to 35% in five bands, less KES 2,400 monthly personal relief"],
      ["Employer", "Withholds and remits; no match"],
      ["Charged on", "Taxable pay: gross, less NSSF, SHIF and the Housing Levy"],
      ["What changed", "Bands are the Finance Act 2023 bands and are not changed by the Finance Act 2026."],
    ],
  },
];

const BANDS = [
  ["First KES 24,000", "10%"],
  ["Next KES 8,333 (to 32,333)", "25%"],
  ["Next KES 467,667 (to 500,000)", "30%"],
  ["Next KES 300,000 (to 800,000)", "32.5%"],
  ["Above KES 800,000", "35%"],
];

const EXAMPLE = [
  ["Gross pay", "50,000.00"],
  ["NSSF (6%; 540 + 2,460)", "− 3,000.00"],
  ["SHIF (2.75%)", "− 1,375.00"],
  ["Housing Levy (1.5%)", "− 750.00"],
  ["Taxable pay", "44,875.00"],
  ["Tax before relief (2,400 + 2,083.25 + 3,762.60)", "8,245.85"],
  ["Less personal relief", "− 2,400.00"],
  ["PAYE payable", "5,845.85"],
  ["Net pay", "39,029.15"],
];

const MISTAKES = [
  {
    q: "Using NHIF bands, or last year's NSSF limits",
    a: "Anything still calculated on NHIF or on the pre-February 2026 NSSF limits under-deducts for higher earners.",
  },
  {
    q: "Taking the Housing Levy off after PAYE",
    a: "That was the old order. Deducted first, it lowers taxable pay and so the tax.",
  },
  {
    q: "Forgetting the employer's own share",
    a: "The school's NSSF and Housing Levy match are real costs that belong in the budget, not just on the remittance slip.",
  },
  {
    q: "Leaving out casual and contract staff",
    a: "Guides on payroll compliance repeatedly list omitted casual and contract workers as a common error. Wages above the taxable level are taxable whatever the contract type.",
  },
  {
    q: "Paying late",
    a: "Late remittance attracts penalties and interest. A payroll that is approved on the 8th of the month leaves no room.",
  },
];

export default function SchoolPayrollStatutoryDeductionsKenyaPost() {
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
        items={[HOME_CRUMB, { name: "Blog", path: "/blog" }, { name: "School payroll deductions in Kenya", path: PATH }]}
      />
      <ArticleJsonLd headline={TITLE} description={DESCRIPTION} path={PATH} datePublished={PUBLISHED_ON} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          School Payroll in Kenya: PAYE, SHIF, NSSF and the Housing Levy Explained (2026)
        </h1>
        <BlogByline publishedOn={PUBLISHED_ON} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          A school is an employer like any other: four statutory deductions
          come off every payslip, and the rules have moved a lot since
          2023. This is what each one is, the rates in force after
          February 2026, the order they are applied in, a worked example,
          and where schools most often go wrong.
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/50">
          General information as of September 2026, not tax advice. Confirm
          against KRA, NSSF and Social Health Authority notices, or with a tax
          professional, before you run payroll.
        </p>
      </Section>

      {/* 2 — Who it applies to */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Who This Covers</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Staff on your school&apos;s own payroll
          </h2>
          <p className="mt-6 text-base leading-relaxed text-marketing-navy-900/75">
            Teachers employed by the Teachers Service Commission are paid and
            taxed through TSC. Everyone your school, its owner or its board
            employs directly is on your payroll: private-school teachers,
            administrators, bursars, drivers, cooks, security and other
            support staff. For them, the school has to work out, deduct,
            and remit these four items every month.
          </p>
        </Reveal>
      </Section>

      {/* 3 — The four deductions */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">The Four Deductions</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            What comes off a payslip in 2026
          </h2>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-5xl gap-10 md:grid-cols-2">
          {DEDUCTIONS.map((d) => (
            <Reveal key={d.name}>
              <d.icon className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
              <p className="mt-3 text-lg font-semibold text-white">{d.name}</p>
              <dl className="mt-4 flex flex-col gap-3">
                {d.lines.map(([k, v]) => (
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
          <p className="text-sm font-semibold text-white">Monthly PAYE bands</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[20rem] text-left text-sm text-white/75">
              <tbody>
                {BANDS.map(([range, rate]) => (
                  <tr key={range} className="border-t border-white/10">
                    <td className="py-2 pr-4">{range}</td>
                    <td className="py-2 text-right font-mono text-marketing-gold-400">{rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </Section>

      {/* 4 — Order matters */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Order Matters</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Deduct first, then tax what is left
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              PAYE is not charged on gross pay. Since 27 December 2024,{" "}
              <a
                href={KRA_NOTICE}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-marketing-navy-950 underline underline-offset-4"
              >
                KRA&apos;s notice
              </a>{" "}
              on the Tax Laws (Amendment) Act 2024 has allowed the Housing
              Levy and SHIF contributions to be deducted in arriving at
              taxable pay, alongside NSSF. So the sequence is: take NSSF,
              SHIF and the Housing Levy off gross pay, apply the PAYE bands to
              what is left, then subtract the KES 2,400 personal relief from
              the tax.
            </p>
            <p>
              This is where older guides and older payroll spreadsheets go
              wrong. Before the change, the Housing Levy and NHIF were taken
              after PAYE and taxable pay was gross minus NSSF only.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 5 — Worked example */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Worked Example</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            A KES 50,000 monthly salary
          </h2>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-left text-sm text-white/75">
              <tbody>
                {EXAMPLE.map(([label, amount], i) => {
                  const strong = ["Taxable pay", "PAYE payable", "Net pay"].includes(label);
                  return (
                    <tr key={label} className={i === 0 ? "" : "border-t border-white/10"}>
                      <td className={`py-2 pr-4 ${strong ? "font-semibold text-white" : ""}`}>{label}</td>
                      <td className={`py-2 text-right font-mono ${strong ? "font-semibold text-marketing-gold-400" : ""}`}>
                        {amount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-white/50">
            Illustrative arithmetic using the 2026 rates above, shown to the
            cent. It is not a payslip from any school. The employer would also
            pay NSSF of KES 3,000 and a Housing Levy match of KES 750 on this
            salary.
          </p>
        </Reveal>
      </Section>

      {/* 6 — Deadlines */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Deadlines</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            The 9th of the following month
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              PAYE, SHIF and the Housing Levy are due by the 9th of the month
              after the payroll month; PAYE is filed through KRA&apos;s iTax
              and the levy is remitted to KRA. Most 2026 guides give the same date for NSSF,
              but the NSSF Act has historically used the 15th, so check the
              date on your NSSF employer portal rather than trusting a
              general guide. Late payment attracts penalties and interest.
            </p>
            <p>
              Keep monthly payroll records for every staff member, including
              casual and contract workers. Five years is the commonly advised
              minimum.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 7 — Mistakes */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">Common Errors</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Five mistakes schools make
          </h2>
          <ol className="mt-8 flex flex-col gap-6">
            {MISTAKES.map((m, i) => (
              <li key={m.q} className="flex gap-4">
                <span className="mt-0.5 font-mono text-sm text-marketing-gold-400">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="text-base font-semibold text-white">{m.q}</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">{m.a}</p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
      </Section>

      {/* 8 — EduCore */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>How EduCore Handles Payroll</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            What it computes, and what it leaves to you
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              EduCore&apos;s payroll works out the employee&apos;s NSSF, SHIF,
              Housing Levy and PAYE, with the KES 2,400 personal relief, in the
              order described above. The statutory rates are kept in a table
              with effective dates, maintained by EduCore, so a payroll run for
              a given month uses the rates that applied that month, including
              the February 2026 NSSF limits. You keep salary structures per
              staff member, add itemised other deductions, and produce payslip
              PDFs that show the school&apos;s KRA PIN and each staff
              member&apos;s KRA, NSSF and SHIF numbers where you have entered
              them.
            </p>
            <p>
              A payroll run moves from draft to approved to paid. Approval
              needs its own permission, so the person who prepares payroll
              is not necessarily the person who signs it off, and an approved
              record can&apos;t be silently regenerated.
            </p>
            <p>
              What it does not do: file returns or remit money to KRA, NSSF or
              the Social Health Authority, show the employer&apos;s matching
              costs on the payslip, or apply other reliefs such as insurance
              premiums, mortgage interest or pension contributions beyond
              NSSF. Those need your accountant. We also ask you to have a tax
              professional confirm the figures before you rely on them for
              statutory filings. Read about the{" "}
              <Link href="/finance-fees" className="font-semibold text-marketing-navy-950 underline underline-offset-4">
                finance and fees module
              </Link>{" "}
              for the rest of the finance features.
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
            Rates and rules change, and this guide is not affiliated with KRA,
            NSSF or the Social Health Authority. It reflects publicly reported
            information as of September 2026 and is not tax advice. Confirm
            current figures with the relevant authority or a qualified tax
            professional.
          </p>
        </Reveal>
      </Section>

      {/* 10 — CTA */}
      <Section tone="canvas" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow>Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Run a test payroll before you commit.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
            Thirty days, no card. Try a sample salary and compare the result
            with your accountant&apos;s.
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
