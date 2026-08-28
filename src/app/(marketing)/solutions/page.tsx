import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Landmark,
  ClipboardList,
  NotebookPen,
  Wallet,
  Smartphone,
  GraduationCap,
} from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { RolePanel } from "@/components/marketing/role-panel";
import { MiniFrame } from "@/components/marketing/mini-frame";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TITLE = "Solutions — EduCore";
const DESCRIPTION =
  "What EduCore changes day to day for School Owners, Principals, Administrators, Teachers, Finance Teams, Parents, and Students — role by role.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/solutions" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/solutions" },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

const ROLE_NAV = [
  { id: "school-owners", label: "School Owners" },
  { id: "principals", label: "Principals" },
  { id: "administrators", label: "Administrators" },
  { id: "teachers", label: "Teachers" },
  { id: "finance-teams", label: "Finance Teams" },
  { id: "parents", label: "Parents" },
  { id: "students", label: "Students" },
];

export default function SolutionsPage() {
  return (
    <>
      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Solutions</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          One platform. A different job made easier for everyone in the building.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          EduCore isn&apos;t one dashboard everyone shares — it&apos;s the same data,
          shaped around what each role actually needs to see and do next.
          Here&apos;s what changes for each one.
        </p>

        <nav
          aria-label="Jump to a role"
          className="mt-10 flex flex-wrap gap-2"
        >
          {ROLE_NAV.map((r) => (
            <a
              key={r.id}
              href={`#${r.id}`}
              className="rounded-full border border-white/15 px-4 py-1.5 text-sm font-medium text-white/75 transition-colors hover:border-marketing-gold-500/50 hover:text-marketing-gold-400"
            >
              {r.label}
            </a>
          ))}
        </nav>
      </Section>

      {/* 2 — School Owners */}
      <Section tone="canvas">
        <Reveal>
          <RolePanel
            id="school-owners"
            icon={Building2}
            eyebrowLabel="For School Owners"
            headline="See the whole operation, not a summary of it."
            narrative="Enrollment, fee collection, staffing, and results usually live in separate places — a register here, a spreadsheet there, a phone call to check on the other campus. EduCore keeps it as one operation you can actually see, across every campus you run."
            changes={[
              "View enrollment, fee collection, and staffing across every campus from one place, instead of asking each site for an update.",
              "Ask Educore AI a plain-language question about your school's own data and get a grounded answer back — available to School Owner and Principal accounts.",
              "Control exactly who can see and do what, module by module, down to individual permissions like approving discounts or viewing payroll.",
              "Pull consolidated reports across academics, finance, and attendance without exporting anything to a spreadsheet first.",
            ]}
          />
        </Reveal>
      </Section>

      {/* 3 — Principals */}
      <Section tone="navy">
        <Reveal>
          <RolePanel
            id="principals"
            icon={Landmark}
            tone="navy"
            eyebrowLabel="For Principals"
            headline="Move between academics, discipline, and staff without switching tools."
            narrative="A principal's day cuts across every department — that's the job. EduCore doesn't make you leave academics to check a discipline case, or leave staff records to approve a correction. It's the same login, the same platform, the whole way through."
            changes={[
              "Approve marks and report cards across every class in the school, not only the ones you personally teach.",
              "Review discipline cases and teacher performance records in the same platform as the academic data they're based on.",
              "Approve attendance corrections and staff leave requests without a separate email thread for each one.",
              "Ask Educore AI a plain-language question about your school's data — available to Principal and School Owner accounts.",
            ]}
          />
        </Reveal>
      </Section>

      {/* 4 — Administrators */}
      <Section tone="canvas">
        <Reveal>
          <RolePanel
            id="administrators"
            icon={ClipboardList}
            eyebrowLabel="For Administrators"
            headline="Admissions, records, and reporting — one platform instead of parallel spreadsheets."
            narrative="Administrators carry the operational load that keeps a school running between terms: applicants who need a status, records that need to stay current, certificates that need issuing. EduCore gives that work one system of record instead of a folder of documents."
            changes={[
              "Track every applicant from inquiry to enrollment in one pipeline, with a live status instead of a paper register.",
              "Keep one record per student that stays consistent across academics, attendance, health, and finance.",
              "Manage the staff directory and issue certificates from the same platform, without re-entering the same details twice.",
            ]}
          />
        </Reveal>
      </Section>

      {/* 5 — Teachers */}
      <Section tone="navy">
        <Reveal>
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <RolePanel
              id="teachers"
              icon={NotebookPen}
              tone="navy"
              eyebrowLabel="For Teachers"
              headline="Attendance, grading, and report comments — in one place, with a head start on the writing."
              narrative="The parts of teaching that eat time outside the classroom — marking a register, entering marks, writing a report comment for every learner — are the parts EduCore is built to shorten, not replace."
              changes={[
                "Mark attendance for your own class in seconds, from any device.",
                "Enter marks for your classes and subjects, then submit them for approval — no separate spreadsheet to reconcile.",
                "Let Educore AI draft the first version of a report-card comment from the learner's actual marks; you edit and approve it, you don't start from a blank page.",
                "Set homework, see submissions as they come in, and grade them without a separate app for it.",
                "Manage your own parent-teacher meeting slots.",
              ]}
            />
            <div className="lg:pt-16">
              <MiniFrame path="app.educore.io/exams/report-cards">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">
                    Amina W. — Grade 7 Blue
                  </p>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    AI draft
                  </Badge>
                </div>
                <p className="mt-2 rounded-md border border-border bg-card p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  Amina has shown consistent improvement in Mathematics this
                  term, particularly in fractions and word problems...
                </p>
                <div className="mt-2 flex gap-2">
                  <span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
                    Edit
                  </span>
                  <span className="rounded-md bg-success/10 px-2 py-1 text-[10px] font-medium text-success">
                    Approve
                  </span>
                </div>
              </MiniFrame>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* 6 — Finance Teams */}
      <Section tone="canvas">
        <Reveal>
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <RolePanel
              id="finance-teams"
              icon={Wallet}
              eyebrowLabel="For Finance Teams"
              headline="Invoicing, M-Pesa payments, and reconciliation — without re-keying anything."
              narrative="School finance runs on matching money that's arrived to invoices that were sent, term after term. EduCore ties the two together automatically instead of leaving reconciliation as a manual, end-of-month scramble."
              changes={[
                "Generate and send fee invoices, and reconcile M-Pesa payments automatically instead of matching statements by hand.",
                "Track receivables and get alerted on overdue balances instead of finding out at term end.",
                "Route discount, waiver, and expense approvals through the platform, with an approval trail attached.",
              ]}
            />
            <div className="lg:pt-16">
              <MiniFrame path="app.educore.io/finance/reconciliation">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">
                    M-Pesa reconciliation
                  </p>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    Auto-matched
                  </Badge>
                </div>
                <div className="mt-2.5 flex flex-col gap-1.5">
                  {[
                    { ref: "SFC4X9K2P1", amount: "KES 18,500", matched: true },
                    { ref: "SFC4X9K2Q7", amount: "KES 6,000", matched: true },
                    { ref: "SFC4X9K2R3", amount: "KES 12,000", matched: false },
                  ].map((row) => (
                    <div
                      key={row.ref}
                      className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5"
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {row.ref}
                      </span>
                      <span className="text-[11px] font-medium text-foreground">
                        {row.amount}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-medium",
                          row.matched ? "text-success" : "text-warning",
                        )}
                      >
                        {row.matched ? "Matched" : "Review"}
                      </span>
                    </div>
                  ))}
                </div>
              </MiniFrame>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* 7 — Parents */}
      <Section tone="navy">
        <Reveal>
          <RolePanel
            id="parents"
            icon={Smartphone}
            tone="navy"
            eyebrowLabel="For Parents"
            headline="One login for fees, attendance, and grades — updates that reach you on WhatsApp."
            narrative="Parents shouldn't have to ask the school office what they could just see. The parent portal gives you your child's actual record, and lets you choose how you hear about the rest."
            changes={[
              "See your child's fee balance, recent payments, and latest report card in one view.",
              "Track attendance for the term, and follow up on homework submissions, grades, and teacher feedback as they're posted.",
              "Book parent-teacher meeting slots directly, and choose how you're notified — SMS, email, or WhatsApp.",
              "Switch between children from one login if you have more than one at the school.",
            ]}
          />
        </Reveal>
      </Section>

      {/* 8 — Students */}
      <Section tone="canvas">
        <Reveal>
          <RolePanel
            id="students"
            icon={GraduationCap}
            eyebrowLabel="For Students"
            headline="Your own login: today's timetable, your record, nothing to chase."
            narrative="Students get their own portal login, scoped to just their own record — not a shared family view. Log in and see today's timetable, this term's attendance, the latest result, and homework, without waiting on a parent to relay it or a notice board to be updated."
            changes={[
              "Today's timetable, pulled straight from the class schedule — no more finding out what's next once you're already at school.",
              "Fee balance and this term's attendance rate, visible directly from your own login.",
              "The latest exam result and class rank, as soon as it's published, with the report card comment alongside it.",
              "Homework assignments, submissions, and feedback in one place.",
            ]}
          />
        </Reveal>
      </Section>

      {/* 9 — Final CTA */}
      <Section tone="navy" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow tone="dark">See it for your school</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Find out what changes for your team.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/65">
            A short walkthrough, shaped around the roles in your school.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/contact">
                Book a Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline-on-dark">
              <Link href="/platform">Explore the Platform</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
