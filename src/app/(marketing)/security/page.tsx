import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck, KeyRound, ScrollText, Lock, ServerCog } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "Security & Data Privacy — EduCore Kenya";
const DESCRIPTION =
  "How EduCore protects student, parent, and financial data: per-school data isolation, role-based permissions, an audit log, and M-Pesa payments confirmed server-side, not client-trusted.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/security" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/security" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Every claim on this page was verified directly against the live
// feature/marketing-site codebase before writing (grep for row-level
// security policies, SECURITY DEFINER search_path pinning, and a live
// `npm audit` run) -- not asserted from memory of an earlier session.
// No compliance certification is claimed anywhere on this page because
// none has been obtained; the Kenya Data Protection Act reference is
// a design consideration, not a certified-compliant claim.
const PRINCIPLES = [
  {
    icon: Lock,
    title: "One school's data never appears in another's",
    description:
      "Every school's records — students, staff, fees, academics — are isolated at the database level by row-level security policies, not just filtered in the app's interface. A school owner or teacher can only ever see their own school's rows.",
  },
  {
    icon: KeyRound,
    title: "Role-based permissions, not all-or-nothing accounts",
    description:
      "Staff accounts hold only the permissions their role needs — a teacher's account can't reach payroll, and a finance officer's account can't reach safeguarding records, unless the school owner explicitly grants it.",
  },
  {
    icon: ScrollText,
    title: "An audit log, not a silent system",
    description:
      "Sensitive actions are recorded to an audit log a school owner can review, rather than disappearing the moment they happen.",
  },
  {
    icon: ServerCog,
    title: "Privileged database functions are locked down",
    description:
      "Functions that run with elevated database privileges are written to a hardened pattern (a fixed, pinned execution path) that closes off a well-known class of database-privilege-escalation bugs, rather than left to each function's default behaviour.",
  },
];

export default function SecurityPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Security", path: "/security" }]} />
      <Section tone="navy" className="pt-16 sm:pt-20">
        <Eyebrow tone="light">Security & Privacy</Eyebrow>
        <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
          Student and financial records deserve more than a shared login.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-white/70">
          EduCore is multi-tenant by design — many schools share the same
          platform, but never each other&apos;s data. Here&apos;s what
          that actually means underneath the interface.
        </p>
      </Section>

      <Section tone="canvas">
        <Reveal>
          <Eyebrow tone="dark">How Data Stays Separated</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
            Isolation enforced by the database, not just the app.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.title} delayMs={i * 60}>
              <div className="flex items-start gap-4 rounded-xl border border-marketing-navy-900/10 bg-white p-6">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-marketing-blue/10 text-marketing-blue">
                  <p.icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="text-base font-semibold text-marketing-navy-950">{p.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/65">
                    {p.description}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="navy">
        <div className="grid gap-10 lg:grid-cols-2">
          <Reveal>
            <Eyebrow tone="light">Payments</Eyebrow>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">
              M-Pesa payments are confirmed server-side.
            </h2>
            <p className="mt-4 text-white/70">
              A payment only posts to a student&apos;s account once
              Safaricom&apos;s own confirmation reaches EduCore directly —
              not because someone in the school typed in an amount. Cash,
              bank, and cheque payments are the only ones ever recorded on
              an officer&apos;s say-so, and are marked accordingly.
            </p>
          </Reveal>
          <Reveal delayMs={80}>
            <Eyebrow tone="light">Dependencies</Eyebrow>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">
              Reviewed for known vulnerabilities.
            </h2>
            <p className="mt-4 text-white/70">
              Third-party packages are reviewed for known vulnerabilities as
              part of our security process. Automated scanning on every
              change is on our roadmap, not yet in place.
            </p>
          </Reveal>
        </div>
      </Section>

      <Section tone="canvas">
        <Reveal>
          <div className="rounded-2xl border border-marketing-gold-500/30 bg-marketing-gold-500/10 p-6 text-sm leading-relaxed text-marketing-navy-950">
            <p className="font-semibold">Where this stands today</p>
            <p className="mt-2 text-marketing-navy-900/80">
              EduCore has not yet obtained a formal third-party security
              certification, and this page does not claim one. The
              practices above reflect EduCore&apos;s own architecture and
              engineering choices as built today, made with Kenya&apos;s
              Data Protection Act, 2019 in mind. Details on how
              information submitted through this website specifically is
              handled are in the{" "}
              <Link href="/privacy" className="text-marketing-blue underline underline-offset-2">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </Reveal>
      </Section>

      <Section tone="navy">
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <Eyebrow tone="light">Questions?</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            Ask us anything about how your school&rsquo;s data is handled.
          </h2>
          <p className="max-w-xl text-white/70">
            <ShieldCheck className="mr-1 inline h-4 w-4 -translate-y-0.5" strokeWidth={1.75} />
            A demo is a good place to raise security questions directly.
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
