import type { Metadata } from "next";
import Link from "next/link";
import {
  Smartphone,
  FileCheck2,
  Split,
  ShieldCheck,
  Receipt,
  ArrowRight,
} from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";

const TITLE = "M-Pesa Fee Collection Automation for Kenyan Schools — EduCore";
const DESCRIPTION =
  "Why manual M-Pesa reconciliation is where Kenyan school bursars lose the most time, and how EduCore automates it — STK push, statement matching, and auto-allocation to invoices.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog/mpesa-fee-collection-automation-kenya-schools" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/blog/mpesa-fee-collection-automation-kenya-schools" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Every EduCore capability below was verified against the codebase before
// writing:
//   - STK push (parent-initiated M-Pesa prompt from the app), with
//     double-dispatch prevention so the same charge can't be pushed twice:
//     supabase/functions/mpesa-stk-push, mpesa-stk-callback,
//     20260821235834_mpesa_stk_push_infrastructure.sql,
//     20260822053847_mpesa_prevent_double_dispatch.sql
//   - Statement reconciliation: a bursar pastes/uploads a Safaricom Paybill
//     statement (CSV/xlsx) and every "paid in" line is matched against
//     payments already recorded by M-Pesa receipt number -- flags
//     amount_mismatch and not_in_system lines instead of a one-code-at-a-
//     time manual search:
//     20260824103019_mpesa_statement_reconciliation.sql
//   - Auto-allocation to invoices, including admissions: an invoice is
//     created as soon as the fee structure is committed to, so a confirmed
//     STK push applies straight to it -- no unallocated-payment limbo, no
//     manual reconciliation step:
//     20260823043831_mpesa_auto_allocate_and_admission_invoice_timing.sql
//   - M-Pesa API credentials encrypted via Supabase Vault, not stored in
//     plaintext:
//     20260828064348_encrypt_mpesa_credentials_via_vault.sql
//   - Callback/confirm endpoints locked down from anon/authenticated direct
//     calls -- only Safaricom's own webhook can confirm a payment:
//     20260822053215_mpesa_lockdown_callback_confirm_from_anon_authenticated.sql
//   - Existing /finance-fees landing page claims (fee structures, invoicing,
//     per-student balances) cross-checked for consistency, not duplicated
//     wholesale.

const FAQS = [
  {
    q: "Does a parent need the EduCore app to pay fees by M-Pesa?",
    a: "No. Payment is a standard M-Pesa STK push -- the parent gets the familiar PIN prompt on their phone. EduCore triggers it and confirms it automatically once Safaricom's callback lands; nothing extra to install.",
  },
  {
    q: "What happens if a parent pays through the school's Paybill directly, not through the app?",
    a: "It still gets accounted for. The Finance team can paste or upload the Paybill statement, and every line is automatically matched against payments already in the system by M-Pesa receipt number -- so a direct Paybill payment doesn't require re-typing it in by hand.",
  },
  {
    q: "Can a payment get applied to the wrong student, or double-counted?",
    a: "Each STK push is tied to a specific request with double-dispatch prevention, so the same charge can't be pushed twice. Reconciliation matches by the M-Pesa receipt number, which is unique per transaction, so a statement line can only match one recorded payment.",
  },
  {
    q: "Does this work for admission payments before a student has a full fee account set up?",
    a: "Yes. The invoice is created as soon as the admissions wizard's Finance step loads the applicable charges, so a confirmed M-Pesa payment applies straight to it instead of sitting as an unallocated payment waiting on a bursar to match it later.",
  },
  {
    q: "Are M-Pesa API credentials safe if a school's account is compromised?",
    a: "Paybill/Till credentials are encrypted at rest via Supabase Vault, not stored as plaintext, and the callback/confirm endpoints only accept calls authenticated as Safaricom's own webhook -- a payment can't be forged by calling the endpoint directly.",
  },
  {
    q: "What if the statement shows money the system doesn't know about?",
    a: "That line is flagged as \"not in system\" rather than silently ignored or auto-created. The bursar records it through the normal Record Payment flow, prefilled with the receipt number and amount from the statement, so nothing gets added to a student's account without someone confirming it.",
  },
];

export default function MpesaFeeCollectionAutomationKenyaPost() {
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
          { name: "M-Pesa Fee Collection Automation", path: "/blog/mpesa-fee-collection-automation-kenya-schools" },
        ]}
      />
      <ArticleJsonLd
        headline={TITLE}
        description={DESCRIPTION}
        path="/blog/mpesa-fee-collection-automation-kenya-schools"
        datePublished="2026-09-04"
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          M-Pesa Fee Collection Automation for Kenyan Schools
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Almost every Kenyan school already collects fees by M-Pesa. The
          part that eats a bursar&apos;s week isn&apos;t the payment itself
          -- it&apos;s proving, line by line, that every shilling on the
          Paybill statement actually made it into a student&apos;s account.
          Here&apos;s where that manual process breaks down, and how EduCore
          automates it instead.
        </p>
      </Section>

      {/* 2 — Where manual reconciliation breaks down */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>The Real Cost</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Where the paper trail falls apart
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              A typical week: parents pay into the school&apos;s Paybill
              from dozens of different phone numbers, a bursar downloads the
              Safaricom statement, and then goes searching -- one M-Pesa
              code at a time -- to confirm each payment landed against the
              right student. Money that doesn&apos;t match anything sits in
              limbo. A receipt typed in wrong sends a real payment to the
              wrong account, and nobody notices until a parent disputes
              their balance at the end of term.
            </p>
            <p>
              None of this is an M-Pesa problem -- Safaricom&apos;s side
              works exactly as designed. It&apos;s a reconciliation problem:
              turning a flat list of transactions into a confirmed,
              per-student balance, without a person cross-checking every
              line by hand.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 3 — Core: EduCore's capabilities */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">Where EduCore Fits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Reconciliation built in, not bolted on
          </h2>
        </Reveal>

        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
          <Reveal>
            <Smartphone className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">A real STK push, confirmed automatically</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              A parent pays through the familiar M-Pesa PIN prompt. Safaricom&apos;s
              callback confirms it directly -- no manual entry -- and the
              same charge can&apos;t be pushed or confirmed twice.
            </p>
          </Reveal>
          <Reveal>
            <FileCheck2 className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Statement matching, not manual searching</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Paste or upload the Paybill statement and every &quot;paid
              in&quot; line is matched against recorded payments by receipt
              number -- matched, amount-mismatch, or not-in-system, at a
              glance instead of one code at a time.
            </p>
          </Reveal>
          <Reveal>
            <Split className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Auto-allocated straight to the invoice</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Invoices exist before the payment does -- even for a new
              admission -- so a confirmed M-Pesa payment applies immediately.
              No unallocated-payment limbo waiting on a bursar to match it.
            </p>
          </Reveal>
          <Reveal>
            <ShieldCheck className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-white">Credentials encrypted, endpoints locked down</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Paybill/Till credentials are encrypted via Supabase Vault, and
              only Safaricom&apos;s own webhook can confirm a payment --
              the endpoint can&apos;t be called directly to forge one.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* 4 — What doesn't get automated */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>What Stays Manual, On Purpose</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Money nobody recognizes doesn&apos;t get invented an owner
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              A statement line with no matching payment is flagged as
              &quot;not in system&quot; -- it is never guessed into a
              student&apos;s account automatically. The bursar records it
              through the same Record Payment flow used for any other
              payment, prefilled with the receipt number and amount already
              pulled from the statement, so confirming it is a click, not a
              re-typing exercise.
            </p>
          </div>
          <div className="mt-8 flex justify-center">
            <Receipt className="h-6 w-6 text-marketing-gold-500" strokeWidth={1.5} />
          </div>
        </Reveal>
      </Section>

      {/* 5 — Product page link */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-base leading-relaxed text-white/75">
            This is one part of{" "}
            <Link href="/finance-fees" className="font-semibold text-marketing-gold-400 underline underline-offset-4">
              EduCore&apos;s fee management system
            </Link>{" "}
            -- fee structures, invoicing, and per-student balances, reconciled
            directly against real M-Pesa payments instead of a spreadsheet.
          </p>
        </Reveal>
      </Section>

      {/* 6 — FAQ */}
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

      {/* 7 — Final CTA */}
      <Section tone="navy" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow tone="dark">Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            See fee reconciliation running your school&apos;s own numbers.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            A demo is built around your school&apos;s actual fee structure --
            not a generic product tour.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/contact">
                Book a Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/finance-fees">Explore Fee Management</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
