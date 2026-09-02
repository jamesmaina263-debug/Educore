import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Fingerprint, MessageSquare, ShieldCheck, ClipboardList } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { ModuleBlock } from "@/components/marketing/module-block";
import { MiniFrame } from "@/components/marketing/mini-frame";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "School Attendance Management System — EduCore Kenya";
const DESCRIPTION =
  "Biometric check-in with automatic guardian SMS, a stream-based register when there's no device, and a permission-gated correction workflow with a real audit trail. The school attendance management system built for Kenya.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/school-attendance-management" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/school-attendance-management" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Grounded in (app)/biometric-kiosk/page.tsx (guardian SMS on check-in,
// confirmed by its own "skip guardian SMS" dry-run toggle) and
// (app)/attendance/actions.ts (permission-gated correction + review flow,
// with previous_status restored on rejection) -- verified by reading both
// files before writing this copy.
const ATTENDANCE_MODULES = [
  {
    icon: Fingerprint,
    title: "Biometric Check-In",
    audience: "Admins & Gate Staff",
    description:
      "A student checks in at a kiosk device and the record posts straight to their attendance — no register to mark by hand for schools running a device.",
    capabilities: ["Kiosk-based biometric check-in", "Works alongside a manual register, not instead of one"],
  },
  {
    icon: MessageSquare,
    title: "Guardian SMS on Check-In",
    audience: "Parents",
    description:
      "A guardian gets an SMS when their child checks in — not a once-a-term summary, the actual moment it happens.",
    capabilities: ["Automatic guardian SMS on biometric check-in"],
  },
  {
    icon: ClipboardList,
    title: "Stream-Based Register",
    audience: "Teachers",
    description:
      "No device at a gate, or a school that doesn't use biometrics yet? Attendance is marked by stream the same way, just typed in rather than tapped.",
    capabilities: ["Manual, stream-based attendance entry", "Same records either way"],
  },
  {
    icon: ShieldCheck,
    title: "Corrections With an Audit Trail",
    audience: "Admins & Class Teachers",
    description:
      "A wrong mark isn't just overwritten. A correction is requested with a reason, goes to whoever holds the review permission, and the original status is restored automatically if it's rejected — not just deleted and forgotten.",
    capabilities: ["Correction requests with a stated reason", "Permission-gated review/approval", "Original record restored on rejection"],
  },
];

export default function SchoolAttendanceManagementPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Attendance Management", path: "/school-attendance-management" }]} />
      <Section tone="navy" className="pt-16 sm:pt-20">
        <Eyebrow tone="light">Attendance</Eyebrow>
        <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
          A school attendance management system that texts the guardian the moment a student checks in.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-white/70">
          Biometric check-in where a school has a device, a stream-based
          register where it doesn&rsquo;t — either way, the same
          record, and a correction workflow that keeps an audit trail
          instead of a silent overwrite.
        </p>
      </Section>

      <Section tone="canvas">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
          <div>
            <Reveal>
              <Eyebrow tone="dark">The Moment It Happens</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
                Not an end-of-day summary. An SMS at the gate.
              </h2>
              <p className="mt-4 max-w-xl text-marketing-navy-900/70">
                A biometric check-in at the kiosk triggers a guardian SMS
                right then — a parent knows their child arrived without
                needing to ask the school. There&apos;s a dry-run mode for
                testing a device against a real enrolled student without
                actually sending that SMS, so a school can pilot the
                hardware without spamming a parent&apos;s phone.
              </p>
            </Reveal>
          </div>
          <Reveal delayMs={150} className="hidden lg:block">
            <MiniFrame path="app.educore.io/biometric-kiosk">
              <p className="text-[11px] font-medium text-foreground">Check-in — Grade 5</p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {[
                  { name: "David Otieno", status: "Checked in · SMS sent", tone: "success" as const },
                  { name: "Faith Njoroge", status: "Checked in · SMS sent", tone: "success" as const },
                ].map((row) => (
                  <div
                    key={row.name}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5"
                  >
                    <span className="text-[10px] text-foreground">{row.name}</span>
                    <Badge
                      variant="secondary"
                      className={cn("font-mono text-[9px]", row.tone === "success" && "bg-success-subtle text-success")}
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
            Two ways to mark attendance, one record either way.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {ATTENDANCE_MODULES.map((m, i) => (
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
              Attendance feeds the rest of a student&apos;s record
            </p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/65">
              Every check-in sits on the same{" "}
              <Link href="/student-management-system" className="text-marketing-blue underline underline-offset-2">
                student record
              </Link>{" "}
              as academics, fees, and discipline — and every guardian SMS uses the same{" "}
              <Link href="/parent-communication" className="text-marketing-blue underline underline-offset-2">
                parent communication
              </Link>{" "}
              channel as everything else the school sends.
            </p>
          </div>
        </Reveal>
      </Section>

      <Section tone="navy">
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <Eyebrow tone="light">Get Started</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            See attendance and guardian SMS running for your own gate.
          </h2>
          <p className="max-w-xl text-white/70">
            A demo covers both paths — biometric and manual — sized to
            whichever your school actually uses.
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
