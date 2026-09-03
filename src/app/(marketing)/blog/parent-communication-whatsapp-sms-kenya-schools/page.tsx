import type { Metadata } from "next";
import Link from "next/link";
import {
  MessageCircle,
  Users,
  Bell,
  Bot,
  ShieldCheck,
  CalendarClock,
  ArrowRight,
} from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "Parent Communication: WhatsApp & SMS for Kenyan Schools — EduCore";
const DESCRIPTION =
  "Why the class WhatsApp group breaks down as a school grows, and how EduCore handles parent communication instead — structured teacher-to-parent items, a two-way WhatsApp assistant, targeted announcements, and fee alerts a human always approves first.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog/parent-communication-whatsapp-sms-kenya-schools" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/blog/parent-communication-whatsapp-sms-kenya-schools" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Every EduCore capability below was verified against the codebase before
// writing:
//   - Educore Connect (structured, student-centric, not open chat; ack ->
//     reply -> resolve workflow):
//     supabase/migrations/20260828060343_educore_connect_phase0_schema.sql
//   - Two-way WhatsApp assistant (bot-first, escalates to a staff inbox,
//     answers fee-balance/attendance questions today):
//     supabase/migrations/20260823173623_whatsapp_chatbot_infrastructure.sql,
//     supabase/functions/_shared/chatbot/{dispatcher,intents}.ts,
//     supabase/functions/_shared/chatbot/tools/{attendance,feeBalance}.ts
//   - Multi-channel broadcast (SMS/email/WhatsApp templates) + per-guardian
//     opt-out preferences by category and channel:
//     supabase/migrations/20260801125815_communication_core.sql,
//     20260803021015_widen_channel_check_constraints.sql,
//     20260807040108_notification_preferences_and_admissions_notes_phase_gap12_13.sql
//   - Automated consecutive-absence alert trigger:
//     supabase/migrations/20260819012127_fix_consecutive_absence_school_days.sql
//   - Fee-threshold arrears alerts, AI-assisted draft, human (Finance) must
//     review and approve before send -- never auto-sent:
//     supabase/migrations/20260816120731_term_newsletters_and_fee_threshold_alerts.sql
//   - Term-end newsletters, automatic + manual "send now":
//     same migration
//   - Targeted announcements (whole-school/grade/class/single student,
//     urgency, delivery/read/acknowledged tracking, audit trail):
//     supabase/migrations/20260831183555_announcements_schema.sql
//   - Parent-teacher meeting booking (teacher-defined slots, capacity):
//     src/app/(app)/pt-meetings/page.tsx
// WhatsApp penetration figures for Kenya researched separately (DataReportal /
// Communications Authority of Kenya / GWI-sourced coverage), not invented.

const FAQS = [
  {
    q: "Does EduCore replace our school's WhatsApp group?",
    a: "It replaces the parts that actually cause problems at scale — reaching one student's guardians specifically, tracking who's read or acknowledged something, and keeping a record for later. A general WhatsApp group can still exist for community announcements; EduCore handles the communication that needs to be accountable.",
  },
  {
    q: "Can parents message the school on WhatsApp through EduCore?",
    a: "Yes. Parents can message the school's WhatsApp number directly and get an automatic answer for common questions like fee balance or attendance. If the bot can't help, or a parent types \"agent\", the conversation is handed to a staff member's inbox.",
  },
  {
    q: "Are fee reminders or arrears alerts sent automatically without anyone checking them?",
    a: "No. A fee-threshold alert is only ever drafted by the system once a balance crosses a school-set threshold — a Finance staff member has to review and explicitly approve it before it goes out. Nothing debt-related leaves the school unreviewed.",
  },
  {
    q: "Can a school message just one class, or one student's guardians, instead of everyone?",
    a: "Yes. Announcements can be targeted to the whole school, a specific grade, a specific class/stream, or a single student's guardians — not just an all-or-nothing broadcast.",
  },
  {
    q: "Do parents have any control over which messages they get?",
    a: "Yes. Each guardian can opt out of specific categories (like general announcements) on specific channels, independently. Fee reminders and absence alerts default to on, since those are the messages a school genuinely needs to be able to deliver.",
  },
  {
    q: "How do parent-teacher meetings get scheduled?",
    a: "Teachers set up bookable time slots with a location and a capacity, and parents book directly against them — no back-and-forth over WhatsApp trying to find a time that works.",
  },
];

export default function ParentCommunicationWhatsappSmsKenyaPost() {
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
          { name: "Parent Communication", path: "/blog/parent-communication-whatsapp-sms-kenya-schools" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Parent Communication for Kenyan Schools: Beyond the WhatsApp Group
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Almost every Kenyan school already knows WhatsApp is where parents
          are. The hard part isn&apos;t choosing the channel — it&apos;s what
          happens once a school has 400 learners, a dozen classes, and one
          group chat trying to carry everything from fee reminders to a
          single child&apos;s attendance issue. Here&apos;s where that breaks
          down, and how EduCore handles parent communication instead.
        </p>
      </Section>

      {/* 2 — Why WhatsApp/SMS matter in Kenya */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Meeting Parents Where They Are</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Why WhatsApp and SMS, specifically
          </h2>
          <p className="mt-6 text-base leading-relaxed text-marketing-navy-900/75">
            WhatsApp reaches the vast majority of smartphone users in Kenya —
            among the highest penetration rates anywhere in Africa — and SMS
            still works reliably even for guardians without a smartphone or
            reliable data. An email-only communication strategy misses a real
            share of Kenyan parents; a system built around WhatsApp and SMS
            starts from where families actually are, not where a foreign
            product assumed they&apos;d be.
          </p>
        </Reveal>
      </Section>

      {/* 3 — Where the group chat breaks down */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">The Real Problem</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Where a single WhatsApp group stops working
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              A class WhatsApp group works fine at 20 parents. It starts to
              strain at 200, and by the time a school has several hundred
              families across every grade, the same group is trying to carry
              fee reminders, exam schedules, one parent&apos;s question about
              their own child, and general chatter — all in one undifferentiated
              stream that anyone can see, and nobody can search six months later.
            </p>
            <p>
              Worse, a group chat has no way to reach <em>one</em> student&apos;s
              guardians specifically without either messaging everyone or
              starting a separate 1-on-1 thread that lives nowhere official.
              There&apos;s no read receipt a school can actually rely on, no
              record for later ({" "}
              <em>&quot;did we actually tell that parent about the absence
              policy?&quot;</em>
              ), and no way to require an acknowledgement before a request is
              considered handled.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 4 — Core: EduCore's capabilities */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Where EduCore Fits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Structured communication, still on the channels parents already use
          </h2>
        </Reveal>

        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
          <Reveal>
            <MessageCircle className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-marketing-navy-950">One item, one student, one thread</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
              A teacher raises something for a specific learner — a request,
              an academic note, an attendance concern — and only that
              student&apos;s guardians see it. The parent reads it, can
              acknowledge or reply, and the teacher resolves it. Not an open
              chat: a fixed, accountable workflow.
            </p>
          </Reveal>
          <Reveal>
            <Bot className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-marketing-navy-950">A WhatsApp number parents can actually message</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
              Parents can text the school&apos;s WhatsApp number and get an
              instant answer to common questions like fee balance or
              attendance. Anything the bot can&apos;t handle — or a parent
              typing &quot;agent&quot; — hands straight to a staff member&apos;s inbox.
            </p>
          </Reveal>
          <Reveal>
            <Bell className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-marketing-navy-950">Announcements targeted, not blasted</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
              A message can go to the whole school, one grade, one class, or
              a single student&apos;s guardians — with urgency levels and a
              record of who&apos;s received, read, and acknowledged it.
            </p>
          </Reveal>
          <Reveal>
            <ShieldCheck className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-marketing-navy-950">A human always approves money-related messages</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
              When a student&apos;s balance crosses a school-set threshold,
              the system only ever drafts a reminder — a Finance staff member
              reviews and explicitly approves it before it ever reaches a
              parent. The same accountability report-card comments get.
            </p>
          </Reveal>
          <Reveal>
            <Users className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-marketing-navy-950">Parents choose their own channel and categories</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
              Every guardian can opt out of specific message categories on
              specific channels independently — fee reminders and absence
              alerts stay on by default, since those are the messages a
              school genuinely needs to be able to deliver.
            </p>
          </Reveal>
          <Reveal>
            <CalendarClock className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-marketing-navy-950">Parent-teacher meetings, booked directly</p>
            <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
              Teachers open time slots with a location and a capacity;
              parents book against them directly — no more coordinating a
              meeting time across a dozen WhatsApp messages.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* 5 — Automated where it should be, human where it must be */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">The Balance That Matters</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Automated where it should be, reviewed where it has to be
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              Some communication genuinely should be automatic: a
              consecutive-absence pattern triggers an alert without a staff
              member having to notice it manually, and end-of-term
              newsletters — merged with the next term&apos;s fee structure —
              go out to every guardian&apos;s email the moment a term ends,
              with a manual &quot;send now&quot; option too.
            </p>
            <p>
              But anything touching a family&apos;s money is treated
              differently, deliberately. A fee-threshold alert can even be
              polished with AI assistance to save a Finance team time — but
              it is never sent automatically. A person reviews the real
              numbers and explicitly approves it first, every time.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 6 — Product page link */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-base leading-relaxed text-marketing-navy-900/75">
            This is one part of a{" "}
            <Link href="/parent-communication" className="font-semibold text-marketing-gold-600 underline underline-offset-4">
              connected parent communication platform
            </Link>{" "}
            — sitting alongside the same system that already puts a
            learner&apos;s report card and competency breakdown directly in
            front of their guardian once it&apos;s released.
          </p>
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

      {/* 8 — Final CTA */}
      <Section tone="canvas" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow>Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-marketing-navy-950 sm:text-4xl">
            See parent communication that scales past the group chat.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
            A demo is built around your school&apos;s own classes and
            communication needs — not a generic tour.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/contact">
                Book a Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/parent-communication">Explore Parent Communication</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
