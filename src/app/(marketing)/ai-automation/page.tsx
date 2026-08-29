import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Sparkles,
  Wand2,
  ShieldQuestion,
  Bot,
  CalendarClock,
  SlidersHorizontal,
} from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { FeatureCard } from "@/components/marketing/feature-card";
import { MiniFrame } from "@/components/marketing/mini-frame";
import { Badge } from "@/components/ui/badge";

const TITLE = "AI & Automation — EduCore";
const DESCRIPTION =
  "How EduCore actually uses AI: grounded in your school's real data, drafted for a human to review, never sent unreviewed. Live features only — nothing on this page is a roadmap promise.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/ai-automation" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/ai-automation" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const AI_DRAFTED = [
  {
    icon: Sparkles,
    title: "AI-assisted report card comments",
    description:
      "For every learner, a short narrative comment drafted from that student's actual marks this term — teachers edit and approve it, it's never sent to a parent unreviewed.",
  },
  {
    icon: Wand2,
    title: "Newsletter tone polish",
    description:
      "Rewrites the tone of a term newsletter template to sound warmer, while keeping every merge placeholder and real figure exactly as written — staff still approve and send.",
  },
  {
    icon: Wand2,
    title: "Fee-alert message polish",
    description:
      "The same tone-polish step, applied to fee-reminder message templates before they go out to parents — a draft to review, not an auto-send.",
  },
  {
    icon: ShieldQuestion,
    title: "Ask Educore AI",
    description:
      "Understands a plain-language question well enough to match it to one of a fixed set of school questions, then answers from your school's real, permission-scoped data — never invented. Available to School Owner and Principal accounts.",
  },
];

const AUTOMATION = [
  {
    icon: CalendarClock,
    title: "Timetable auto-generation",
    description:
      "Fills a school's weekly timetable automatically from each subject's periods-per-week requirement, respecting stream and teacher double-booking rules — a scheduling algorithm, not a language model.",
  },
  {
    icon: Bot,
    title: "WhatsApp parent bot",
    description:
      "Answers simple, common questions like a child's fee balance or attendance straight over WhatsApp, matched by keyword rather than free-form understanding — anything it doesn't recognize is hands straight to a staff member.",
  },
  {
    icon: SlidersHorizontal,
    title: "At-risk student ranking",
    description:
      "Ranks students by a hand-weighted score across attendance trend, exam trend, payment lateness, and discipline cases — a transparent formula school staff can reason about, not a trained model.",
  },
];

export default function AIAutomationPage() {
  return (
    <>
      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">AI &amp; Automation</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          AI that drafts. A person who decides.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Every AI feature in EduCore does one of two things: draft something a
          person reviews, or answer a question from data your school already
          has. Nothing on this page writes to a student record, sends a
          message, or reaches a parent without a human approving it first.
        </p>
      </Section>

      {/* 2 — How it actually works */}
      <Section tone="canvas">
        <Reveal>
          <Eyebrow>How this actually works</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Grounded in your data. Reviewed by a person. Never guessing.
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <div>
              <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-marketing-blue">
                01
              </p>
              <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
                AI never touches your database directly. It works from real
                records already pulled through your school&apos;s normal
                permissions — it can&apos;t see, or answer with, anything a
                given user couldn&apos;t already access.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-marketing-blue">
                02
              </p>
              <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
                Where AI drafts something — a comment, a newsletter, a message —
                it produces a first version, not a final one. Nothing reaches
                a parent or a student until a teacher or staff member reviews
                and sends it.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-marketing-blue">
                03
              </p>
              <p className="mt-2 text-sm leading-relaxed text-marketing-navy-900/70">
                Not everything labeled &quot;automation&quot; is AI. A
                scheduling algorithm and a hand-weighted risk score are
                automation, not a language model — and this page says which is
                which.
              </p>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* 3 — AI-drafted features */}
      <Section tone="navy">
        <Reveal>
          <div className="grid gap-10 lg:grid-cols-[1fr_0.85fr] lg:items-start">
            <div>
              <Eyebrow tone="dark">AI-drafted</Eyebrow>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Where EduCore actually uses a language model.
              </h2>
              <p className="mt-4 max-w-lg text-base leading-relaxed text-white/65">
                Four features, all built on the same rule: the model drafts,
                a person decides.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {AI_DRAFTED.map((f) => (
                  <FeatureCard
                    key={f.title}
                    icon={f.icon}
                    title={f.title}
                    description={f.description}
                    tone="navy"
                  />
                ))}
              </div>
            </div>

            <MiniFrame path="app.educore.io/ai">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">
                  Ask Educore AI
                </p>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  School Owner
                </Badge>
              </div>
              <div className="mt-2.5 flex flex-col gap-2">
                <div className="ml-auto max-w-[85%] rounded-md bg-primary/10 px-2.5 py-1.5 text-[11px] text-foreground">
                  How many students are absent today?
                </div>
                <div className="max-w-[90%] rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  14 students are absent today, out of 612 enrolled — a 97.7%
                  attendance rate.
                </div>
              </div>
              <p className="mt-2.5 text-[10px] text-muted-foreground">
                Answers a fixed set of school questions, from your school&apos;s
                real data
              </p>
            </MiniFrame>
          </div>
        </Reveal>
      </Section>

      {/* 4 — Automation (not AI) */}
      <Section tone="canvas">
        <Reveal>
          <div className="grid gap-10 lg:grid-cols-[1fr_0.85fr] lg:items-start">
            <div>
              <Eyebrow>Automation — not AI</Eyebrow>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
                Rules-based work, done automatically.
              </h2>
              <p className="mt-4 max-w-lg text-base leading-relaxed text-marketing-navy-900/70">
                These save real time too — they&apos;re just not a language
                model. Worth being precise about, since the difference
                actually matters for what you can trust each one to do.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-1">
                {AUTOMATION.map((f) => (
                  <FeatureCard
                    key={f.title}
                    icon={f.icon}
                    title={f.title}
                    description={f.description}
                    tone="canvas"
                  />
                ))}
              </div>
            </div>

            <MiniFrame path="app.educore.io/communication">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">
                  WhatsApp — parent bot
                </p>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  Bot
                </Badge>
              </div>
              <div className="mt-2.5 flex flex-col gap-2">
                <div className="ml-auto max-w-[85%] rounded-md bg-primary/10 px-2.5 py-1.5 text-[11px] text-foreground">
                  What&apos;s my daughter&apos;s fee balance?
                </div>
                <div className="max-w-[90%] rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  Amina&apos;s balance for Term 2 is KES 4,200.
                </div>
                <div className="ml-auto max-w-[85%] rounded-md bg-primary/10 px-2.5 py-1.5 text-[11px] text-foreground">
                  Can you also help with my son&apos;s transfer letter?
                </div>
                <div className="max-w-[90%] rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground">
                  Let me get a staff member to help with that.
                </div>
              </div>
              <p className="mt-2.5 text-[10px] text-muted-foreground">
                Keyword-matched, not free-form — hands off to staff when
                unsure
              </p>
            </MiniFrame>
          </div>
        </Reveal>
      </Section>

      {/* 5 — Honesty note */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">Where we stand today</Eyebrow>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Everything on this page is live in EduCore right now.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/65">
            Nothing above is a roadmap item or a future promise — it&apos;s
            what the product actually does today, for schools already using
            it.
          </p>
        </Reveal>
      </Section>

      {/* 6 — Final CTA */}
      <Section tone="canvas" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow>See it on your own data</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-marketing-navy-950 sm:text-4xl">
            See how it handles a real school day.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-marketing-navy-900/70">
            A short walkthrough, using questions like the ones your staff
            would actually ask.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href="/contact">
                Book a Demo <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline">
              <Link href="/platform">Explore the Platform</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
