import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Wallet, Banknote, Package, FileSpreadsheet, ShieldCheck } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { ModuleBlock } from "@/components/marketing/module-block";
import { MiniFrame } from "@/components/marketing/mini-frame";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "M-Pesa School Fees Management System — EduCore Kenya";
const DESCRIPTION =
  "M-Pesa fee reconciliation built in, not bolted on: fee structures, invoicing, per-student balances, and automatic M-Pesa matching — the school fees management system built for how Kenyan schools actually get paid.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/finance-fees" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/finance-fees" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Every module/capability below is the same content already shipped on
// /platform's "Finance & Resources" section — this page gives it more
// room, it doesn't introduce any new claim.
const FINANCE_MODULES = [
  {
    icon: Wallet,
    title: "Finance & Fees",
    audience: "Finance Teams",
    description:
      "Fee structures, invoicing, and per-student accounts, reconciled against M-Pesa payments instead of matched by hand against a paper ledger.",
    capabilities: [
      "Fee structures per term, class, or student",
      "Invoicing generated from real charges, not guessed amounts",
      "Per-student account balances, always current",
      "M-Pesa payment reconciliation",
    ],
  },
  {
    icon: Banknote,
    title: "Payroll",
    audience: "Finance & HR",
    description:
      "Salary structures and monthly payroll runs, with NSSF, SHIF, Housing Levy, and PAYE computed against current Kenyan statutory rates.",
    capabilities: ["Salary structures", "Monthly payroll runs", "Kenyan statutory deductions computed automatically"],
  },
  {
    icon: Package,
    title: "Inventory & Procurement",
    audience: "Finance & Store Officers",
    description:
      "Requisitions, purchase orders, suppliers, and stock levels, tied to the same finance records rather than a separate spreadsheet nobody reconciles.",
    capabilities: ["Requisition-to-purchase-order workflow", "Supplier records", "Stock levels across stores"],
  },
];

export default function FinancePage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Finance & Fees", path: "/finance-fees" }]} />
      <Section tone="navy" className="pt-16 sm:pt-20">
        <Reveal>
          <Eyebrow tone="light">Finance & Fees</Eyebrow>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            M-Pesa-native school fees management — built for how Kenyan schools actually get paid.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/70">
            Fee structures, invoices, and per-student balances stay in one
            place, reconciled directly against M-Pesa payments — not
            matched by hand at the end of the week.
          </p>
        </Reveal>
      </Section>

      <Section tone="canvas">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
          <div>
            <Reveal>
              <Eyebrow tone="dark">M-Pesa, Built In</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
                Payments confirmed by M-Pesa, not by trusting a typed-in amount.
              </h2>
              <p className="mt-4 max-w-xl text-marketing-navy-900/70">
                Only cash, bank, and cheque payments are ever recorded on an
                officer&apos;s say-so. Real M-Pesa money only posts to a
                student&apos;s account once Safaricom&apos;s own callback
                confirms it — so a balance on screen reflects money that has
                actually arrived, not an unconfirmed declaration.
              </p>
            </Reveal>
          </div>
          <Reveal delayMs={150} className="hidden lg:block">
            <MiniFrame path="app.educore.io/finance/reconciliation">
              <p className="text-[11px] font-medium text-foreground">M-Pesa reconciliation</p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {[
                  { ref: "TGH4K9P2X1", status: "Matched", tone: "success" as const },
                  { ref: "TGH4K9Q7Z3", status: "Matched", tone: "success" as const },
                  { ref: "TGH4K9R0A8", status: "Pending", tone: "warning" as const },
                ].map((row) => (
                  <div
                    key={row.ref}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">{row.ref}</span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "font-mono text-[9px]",
                        row.tone === "success" && "bg-success-subtle text-success",
                        row.tone === "warning" && "bg-warning-subtle text-warning",
                      )}
                    >
                      {row.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </MiniFrame>
          </Reveal>
        </div>
      </Section>

      <Section tone="navy">
        <Reveal>
          <Eyebrow tone="light">The Modules</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            Fees, payroll, and procurement — connected, not separate spreadsheets.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FINANCE_MODULES.map((m, i) => (
            <Reveal key={m.title} delayMs={i * 40}>
              <ModuleBlock
                tone="navy"
                icon={m.icon}
                title={m.title}
                audience={m.audience}
                description={m.description}
                capabilities={m.capabilities}
              />
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="canvas">
        <Reveal>
          <div className="flex items-start gap-3 rounded-2xl border border-marketing-navy-900/10 bg-white p-6">
            <FileSpreadsheet className="mt-0.5 h-5 w-5 flex-shrink-0 text-marketing-blue" strokeWidth={1.75} />
            <div>
              <p className="text-sm font-semibold text-marketing-navy-950">
                Termly, per-student billing
              </p>
              <p className="mt-1 text-sm leading-relaxed text-marketing-navy-900/65">
                Pricing scales by student count and module coverage —{" "}
                <Link href="/pricing" className="text-marketing-blue underline underline-offset-2">
                  see the plans
                </Link>{" "}
                or talk to us for a quote sized to your school.
              </p>
            </div>
          </div>
        </Reveal>
      </Section>

      <Section tone="navy">
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <Eyebrow tone="light">Get Started</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            See fee reconciliation running your school&rsquo;s own numbers.
          </h2>
          <p className="max-w-xl text-white/70">
            <ShieldCheck className="mr-1 inline h-4 w-4 -translate-y-0.5" strokeWidth={1.75} />
            A demo walks through your actual fee structure, not a generic
            sample school.
          </p>
          <MarketingButton size="lg" asChild className="mt-2">
            <Link href="/contact">
              Book a Demo <ArrowRight className="h-4 w-4" />
            </Link>
          </MarketingButton>
        </Reveal>
      </Section>
    </>
  );
}
