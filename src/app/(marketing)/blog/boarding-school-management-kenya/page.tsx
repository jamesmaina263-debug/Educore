import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, BedDouble, Stethoscope, DoorOpen, ArrowRight } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { ArticleJsonLd } from "@/components/marketing/article-json-ld";
import { BlogByline } from "@/components/marketing/blog-byline";
import { TRIAL_HREF, TRIAL_CTA_SHORT } from "@/lib/marketing/trial";

const SLUG = "boarding-school-management-kenya";
const PATH = `/blog/${SLUG}`;
const PUBLISHED_ON = "2026-09-21";
const TITLE = "Boarding School Management in Kenya: Safety Standards, Roll Call and the Records That Matter — EduCore";
const DESCRIPTION =
  "What the Ministry's Safety Standards Manual expects of a boarding school, the records that back those standards up, how to handle exeats and visitors, and what software can and cannot do.";
const NATION_ARTICLE =
  "https://nation.africa/kenya/news/history-of-school-fire-tragedies-and-what-the-safety-guidelines-say-5477284";
const KNA_ARTICLE = "https://www.kenyanews.go.ke/tragedy-and-neglect-school-fires-and-the-unlearned-safety-lessons/";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH, images: ["/og-image.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.png"] },
};

// Sourcing (researched Sep 2026). NOTE: the Ministry of Education's Safety
// Standards Manual for Schools in Kenya (2008) itself was NOT read directly.
// Its requirements are taken from news reports quoting it (Nation, Kenya
// News Agency, Pulse, Citizen), which agree with each other; the copy says
// "as reported" and tells readers to read the manual.
//   - Building: dormitory doors at least 5 ft wide, opening outwards, never
//     locked from outside while learners are inside; a door at each end plus a
//     marked middle emergency exit; beds at least 1.2 m apart; corridors at
//     least 2 m; windows without grills that open outwards easily; bunk beds
//     strong with side grills.
//   - Equipment/drills: working extinguishers at each exit; accessible fire
//     alarms; evacuation maps at each entrance and exit; fire drills at least
//     twice a term.
//   - Routine: accurate roll call every day with records kept; spot checks
//     before learners go to bed; regular security patrols; no visitors in the
//     dormitory; hygiene inspections on alternate days. A 2021 PS circular
//     asked boarding schools for more teachers on duty around dormitories,
//     guidance and counselling, and spot checks before sleep.
//   - Context: after a national assessment following the Hillside Endarasha
//     fire (Sept 2024), the Education CS said 348 boarding schools were
//     non-compliant and would operate as day schools from Jan 2025. After the
//     Utumishi Girls Academy fire (Gilgil, 27 May 2026; 16 students died),
//     the CS reported preliminary findings of an overcrowded dormitory and a
//     locked exit door; the cause is still under investigation, so the post
//     says nothing about cause. It is mentioned briefly and without any
//     product tie-in.
//   - No source read prescribes an exeat/visitor-log format; that section is
//     labelled as suggested practice, not regulation.
// EduCore statements were checked in the repo:
//   - Boarding: houses / rooms / beds with per-house gender, capacity, house
//     master and assistant; bed allocation and transfers (with reason); roll
//     call in two daily sessions (boarding_am / boarding_pm) with present /
//     absent / sick bay / excused / late, mark-all-present, works offline and
//     syncs; incident log (bullying, property damage, curfew violation, health
//     emergency, fighting, other) with location, action taken and follow-up;
//     dashboard with occupancy, today's absentees, sick-bay count, open
//     incidents and capacity alerts (room occupied >= its recorded capacity);
//     boarding summary and dormitory utilisation reports.
//   - Health: sick-bay visits with outcomes (returned to class, sent home,
//     referred, collected by guardian), guardian notification from a visit,
//     medication administration records, medical inventory, referrals,
//     emergencies and records.
//   - NOT built (and the post says so): an exeat / leave-out or visitor log;
//     fire-drill, extinguisher or building-inspection registers. Capacity is
//     whatever the school records, so the software cannot know a dormitory's
//     safe capacity under the spacing rules.

const FAQS = [
  {
    q: "How many students can sleep in one dormitory?",
    a: "There is no single number; it depends on the floor area. The Ministry's Safety Standards Manual, as reported, requires at least 1.2 metres between beds and corridors of at least two metres, so the safe capacity is what fits inside those distances with exits clear. Measure the room and record that number, not the number of beds someone has managed to fit.",
  },
  {
    q: "Can a dormitory door be locked at night?",
    a: "Not with learners inside. As reported from the Ministry's manual, dormitory doors must open outwards and must never be locked from outside while learners are in the building. Any security measure that depends on a key being in the right hand at midnight fails that test.",
  },
  {
    q: "How often should a boarding school take roll call?",
    a: "The Ministry's guidance, as reported, asks for an accurate roll call every day with records kept. Many schools take two, morning and evening, plus a spot check before lights out. What matters is that the head count is written down and someone reads it.",
  },
  {
    q: "Should parents be allowed into the dormitory on visiting day?",
    a: "The guidance as reported says no visitor should be allowed in the dormitory. Receive visitors in a designated area and let the learner come to them, with a signed record of who came, when and who they saw.",
  },
  {
    q: "Does EduCore handle exeats and visitor logs?",
    a: "Not today. EduCore covers dormitory structure and bed allocation, twice-daily roll call, boarding incidents, transfers, and the sick bay and health records. It does not yet have a dedicated exeat, leave-out or visitor log, or registers for fire drills and equipment servicing. Schools keep those separately for now.",
  },
];

const BUILDING = [
  "Doors at least five feet wide that open outwards and are never locked from outside while learners are inside.",
  "A door at each end of the dormitory plus a clearly marked emergency exit in the middle.",
  "At least 1.2 metres between beds and corridors of at least two metres.",
  "Windows without grills that open outwards easily, and strong bunk beds fitted with side grills.",
  "Working fire extinguishers at each exit, accessible alarms, and evacuation maps at every entrance and exit.",
  "Fire drills at least twice a term.",
];

const ROUTINE = [
  "An accurate roll call every day, with the records kept.",
  "Spot checks by teachers or administration before learners go to bed.",
  "Regular patrols by security personnel, and no visitors in the dormitory.",
  "Hygiene inspections of dormitories and learners on alternate days.",
];

const RECORDS = [
  {
    icon: BedDouble,
    title: "Occupancy against safe capacity",
    body: "For every room: the safe capacity you measured, the beds in it, and who is allocated where. Overcrowding is easy to miss when nobody is counting.",
  },
  {
    icon: ClipboardList,
    title: "Roll call, morning and evening",
    body: "Who was present, absent, in the sick bay or excused, taken by a named person and signed. An absence is a question that must be answered the same day.",
  },
  {
    icon: DoorOpen,
    title: "Movements in and out",
    body: "Exeats, visitors and anyone leaving the compound: who approved it, when they left, when they returned. Reconcile it against roll call.",
  },
  {
    icon: Stethoscope,
    title: "Incidents, sick bay and medication",
    body: "What happened, where, what was done and who was told. Every dose given, by whom, and when a guardian was informed.",
  },
];

export default function BoardingSchoolManagementKenyaPost() {
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
        items={[HOME_CRUMB, { name: "Blog", path: "/blog" }, { name: "Boarding school management in Kenya", path: PATH }]}
      />
      <ArticleJsonLd headline={TITLE} description={DESCRIPTION} path={PATH} datePublished={PUBLISHED_ON} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Guide</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Boarding School Management in Kenya: Safety Standards, Roll Call and the Records That Matter
        </h1>
        <BlogByline publishedOn={PUBLISHED_ON} />
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          A boarding school is responsible for children around the clock.
          Kenya already has clear standards for how dormitories should be
          built and run, and the past two years of school fires have put
          them under scrutiny. This is a plain guide to what the standards
          ask, the records that show you follow them, and what software can
          and cannot do.
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/50">
          Requirements below are as reported from the Ministry of
          Education&apos;s Safety Standards Manual for Schools in Kenya (2008).
          Read the manual and any current circulars for the authoritative text.
        </p>
      </Section>

      {/* 2 — Standards */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>What The Standards Ask</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            The building, and the routine
          </h2>
          <p className="mt-6 text-base leading-relaxed text-marketing-navy-900/75">
            After the Hillside Endarasha fire in 2024, a national assessment
            found 348 boarding schools non-compliant, and the Cabinet
            Secretary ordered them to operate as day schools from January
            2025. After the fire at Utumishi Girls Academy on 27 May 2026,
            the Education Cabinet Secretary reported preliminary findings of
            an overcrowded dormitory and a locked exit door; the cause is
            still under investigation. The standards themselves are not
            new. Reported summaries of the 2008 manual (
            <a
              href={NATION_ARTICLE}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-marketing-navy-950 underline underline-offset-4"
            >
              Nation
            </a>
            ,{" "}
            <a
              href={KNA_ARTICLE}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-marketing-navy-950 underline underline-offset-4"
            >
              Kenya News Agency
            </a>
            ) include:
          </p>
          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-marketing-navy-950">The building and equipment</p>
              <ul className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-marketing-navy-900/75">
                {BUILDING.map((b) => (
                  <li key={b} className="flex gap-3">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-marketing-gold-600" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-marketing-navy-950">The daily routine</p>
              <ul className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-marketing-navy-900/75">
                {ROUTINE.map((r) => (
                  <li key={r} className="flex gap-3">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-marketing-gold-600" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* 3 — Records */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="dark">The Paper Trail</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Four records every boarding school should keep
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            None of these makes a dormitory safe. Doors, exits, extinguishers
            and drills do that. Records show whether you are doing what you
            think you are, and give you answers when someone asks.
          </p>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
          {RECORDS.map((r) => (
            <Reveal key={r.title}>
              <r.icon className="h-5 w-5 text-marketing-gold-500" strokeWidth={1.75} />
              <p className="mt-3 text-sm font-semibold text-white">{r.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/70">{r.body}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 4 — Exeats and visitors */}
      <Section tone="canvas">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow>Exeats And Visitors</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-marketing-navy-950 sm:text-3xl">
            Design a process, then keep to it
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-marketing-navy-900/75">
            <p>
              The sources we read do not prescribe an exeat or visitor-log
              format, so this is suggested practice, not regulation. It is
              built from the same principle as the rest: every child is
              accounted for, at every hour, by a named person.
            </p>
            <p>
              An exeat should be requested by the parent or guardian, approved
              by a named teacher, dated with the time out and the expected
              return, and signed by whoever collects the child. When the
              child comes back it is signed in. Anyone not signed back in by
              the expected time is followed up the same evening, and the
              evening roll call is the check that catches the gaps.
            </p>
            <p>
              Visitors are received in a designated place, not in the
              dormitory, and the learner is called to them. Log the visitor&apos;s
              name, who they saw, and the times in and out.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 5 — EduCore */}
      <Section tone="navy">
        <Reveal className="mx-auto max-w-3xl">
          <Eyebrow tone="dark">How EduCore Fits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            What it records, and what it does not
          </h2>
          <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-white/75">
            <p>
              EduCore&apos;s boarding module keeps the dormitory structure:
              houses, rooms and beds, each house with its gender, a house
              master and an assistant, and a capacity for each room. Beds are
              allocated to students individually, transfers record a reason,
              and the dashboard shows occupancy, today&apos;s absentees, the
              sick-bay count, open incidents and any room whose occupied beds
              have reached its recorded capacity.
            </p>
            <p>
              Roll call runs in two sessions a day, morning and evening, with
              present, absent, sick bay, excused and late, and it keeps working
              offline and syncs when the connection returns. Incidents are
              logged by type (bullying, property damage, curfew violation,
              health emergency, fighting), with the location, the action taken
              and the follow-up. The health module records sick-bay visits and
              their outcomes, lets staff notify a guardian from the visit, and
              keeps medication administration records.
            </p>
            <p>
              What it does not do: know your dormitory&apos;s safe capacity, since
              the capacity is whatever you record, so it must come from a
              measurement, not from the number of beds. It also has no
              dedicated exeat, leave-out or visitor log yet, and no registers
              for fire drills or equipment servicing. Those stay on paper or
              in a spreadsheet for now. Software keeps the records honest and
              findable; it cannot unlock a door or service an extinguisher.
            </p>
          </div>
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
          <p className="mt-8 text-xs leading-relaxed text-marketing-navy-900/50">
            This guide summarises publicly reported Ministry of Education
            standards as of September 2026 and is general information, not
            legal or engineering advice. EduCore is not affiliated with the
            Ministry of Education. Confirm current requirements with the
            Ministry and your county education office, and have a qualified
            professional inspect your dormitories.
          </p>
        </Reveal>
      </Section>

      {/* 7 — CTA */}
      <Section tone="navy" className="text-center">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
          <Eyebrow tone="dark">Get Started</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            See the boarding module with your own dormitories.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            Thirty days, no card. Set up your houses, rooms and beds and run a
            roll call.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MarketingButton asChild size="lg">
              <Link href={TRIAL_HREF}>
                {TRIAL_CTA_SHORT} <ArrowRight className="h-4 w-4" />
              </Link>
            </MarketingButton>
            <MarketingButton asChild size="lg" variant="outline-on-dark">
              <Link href="/contact">Book a Demo</Link>
            </MarketingButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
