import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MessageCircle, Send, Bell, CalendarClock, LayoutDashboard } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { ModuleBlock } from "@/components/marketing/module-block";
import { MiniFrame } from "@/components/marketing/mini-frame";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "Parent Communication Platform Kenya — EduCore";
const DESCRIPTION =
  "WhatsApp and SMS from one place, structured teacher-to-parent items instead of a group chat, termly newsletters sent automatically, and fee alerts a human always approves first. The parent communication platform built for Kenyan schools.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/parent-communication" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/parent-communication" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Grounded in the Communication module block already shipped on
// /platform, plus api/cron/school-comms/route.ts (verified by reading it
// directly): the newsletter sweep is fully automatic and idempotent, but
// fee-threshold alerts are only ever *drafted* by the system -- a Finance
// user has to explicitly approve one before it sends. That distinction is
// a real trust point for a parent-facing channel and worth stating
// precisely rather than rounding it up to "automatic alerts."
const COMMUNICATION_MODULES = [
  {
    icon: MessageCircle,
    title: "Structured Parent Items",
    audience: "Teachers & Parents",
    description:
      "A request, an academic note, an attendance flag — sent as a structured, per-student item from a class teacher to that student's parents, not dropped into an open group chat everyone has to scroll through.",
    capabilities: ["Per-student teacher-to-parent items", "Read receipts, acknowledge & reply", "Only the raising teacher can mark it resolved"],
  },
  {
    icon: Send,
    title: "WhatsApp & SMS, One Place",
    audience: "Admins & Teachers",
    description:
      "Compose and send updates over WhatsApp and SMS from the same screen, with message history and reusable templates — not an admin's personal phone doing the school's messaging.",
    capabilities: ["WhatsApp & SMS composing", "Reusable message templates", "Sent-message history"],
  },
  {
    icon: Bell,
    title: "Termly Newsletters & Fee Alerts",
    audience: "Admins & Finance",
    description:
      "Term-end newsletters go out on their own once a term closes — no one has to remember to send them. Fee-threshold alerts work differently on purpose: the system only ever drafts one when a balance crosses the school's set threshold, and a Finance user has to approve it before a parent sees it.",
    capabilities: ["Automatic termly newsletter sweep", "Fee alerts drafted automatically, sent only after approval"],
  },
  {
    icon: CalendarClock,
    title: "Parent-Teacher Meetings",
    audience: "Teachers & Parents",
    description:
      "Meetings scheduled and tracked in the platform instead of arranged over a chain of phone calls that only one person remembers happened.",
    capabilities: ["Meeting scheduling & tracking"],
  },
  {
    icon: LayoutDashboard,
    title: "Parent Portal",
    audience: "Parents",
    description:
      "A separate login where a parent sees their own child's fee balance, latest report card, and recent payments directly — not a summary relayed by the school office.",
    capabilities: ["Fee balance & recent payments", "Latest report card", "One login per guardian, linked to their children"],
  },
];

export default function ParentCommunicationPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Parent Communication", path: "/parent-communication" }]} />
      <Section tone="navy" className="pt-16 sm:pt-20">
        <Eyebrow tone="light">Parent Communication</Eyebrow>
        <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
          A parent communication platform, not an admin&rsquo;s personal WhatsApp.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-white/70">
          WhatsApp, SMS, structured per-student items, and a parent
          portal — all from one place, with a human approving anything
          that touches a fee balance before it ever reaches a parent.
        </p>
      </Section>

      <Section tone="canvas">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
          <div>
            <Reveal>
              <Eyebrow tone="dark">A Note, Not a Group Chat</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
                One thread per issue, addressed to one family.
              </h2>
              <p className="mt-4 max-w-xl text-marketing-navy-900/70">
                A class teacher raises a note about one student, addressed
                to that student&apos;s own parents — not the whole
                class&apos;s WhatsApp group. The parent reads it, can
                acknowledge or reply, and only the teacher who raised it
                can mark it resolved. Nothing gets buried under fifty
                unrelated messages.
              </p>
            </Reveal>
          </div>
          <Reveal delayMs={150} className="hidden lg:block">
            <MiniFrame path="app.educore.io/communication">
              <p className="text-[11px] font-medium text-foreground">Parent item — Grade 6</p>
              <div className="mt-2.5 flex flex-col gap-1.5 text-[10px] text-muted-foreground">
                <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
                  Missed homework — Math, due Mon
                </div>
                <div className="rounded-md border border-border bg-card px-2.5 py-1.5 text-success">
                  Acknowledged by parent
                </div>
              </div>
            </MiniFrame>
          </Reveal>
        </div>
      </Section>

      <Section tone="navy">
        <Reveal>
          <Eyebrow tone="light">The Modules</Eyebrow>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            Every way a school reaches a parent, in one place.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {COMMUNICATION_MODULES.map((m, i) => (
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
          <div className="rounded-2xl border border-marketing-navy-900/10 bg-white p-6">
            <p className="text-sm font-semibold text-marketing-navy-950">
              Connected to attendance and fees, not a separate app
            </p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/65">
              A guardian&apos;s SMS on{" "}
              <Link href="/school-attendance-management" className="text-marketing-blue underline underline-offset-2">
                attendance check-in
              </Link>{" "}
              and their view into{" "}
              <Link href="/finance-fees" className="text-marketing-blue underline underline-offset-2">
                fees and M-Pesa reconciliation
              </Link>{" "}
              run through this same channel and the same parent portal login.
            </p>
          </div>
        </Reveal>
      </Section>

      <Section tone="navy">
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <Eyebrow tone="light">Get Started</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            See parent communication set up for your own school.
          </h2>
          <p className="max-w-xl text-white/70">
            A demo covers WhatsApp, SMS, and the parent portal exactly as
            your school&rsquo;s families would see them.
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
