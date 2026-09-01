import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, Layers, FileSpreadsheet, BookOpen, Sliders } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { ModuleBlock } from "@/components/marketing/module-block";
import { MiniFrame } from "@/components/marketing/mini-frame";
import { Badge } from "@/components/ui/badge";

const TITLE = "CBC School Management System — EduCore Kenya";
const DESCRIPTION =
  "A CBC school management system that also handles 8-4-4-style numeric grading side by side — set per school, grade, or class. Built for Kenya's competency-based curriculum, not bolted onto a foreign grading model.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/cbc-school-management" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/cbc-school-management" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Grounded directly in (app)/exams/_data.ts and the grading_scales /
// grading_scale_bands schema (model_type: "numeric" | "cbc", with
// configurable label/min_score/max_score bands per scale) -- verified by
// reading that file before writing this copy. The NEMIS claim is the same
// sentence already shipped on /solutions, not a new claim introduced here.
const CBC_MODULES = [
  {
    icon: Sliders,
    title: "Configurable Competency Bands",
    audience: "Academic Heads",
    description:
      "Grading scales are set up per school, grade, or even class — a CBC competency scale for lower grades and a numeric scale for a form using the old system, running side by side, not forced into one model.",
    capabilities: ["CBC or numeric grading scale, chosen per class", "Custom bands per scale", "No school-wide single grading model forced on every class"],
  },
  {
    icon: ClipboardCheck,
    title: "CATs, Exams & Marks Entry",
    audience: "Teachers",
    description:
      "The same marks-entry workflow teachers already use, graded against whichever scale is set for that class — a CBC band, not a numeric percentage translated into one after the fact.",
    capabilities: ["CAT and exam scheduling", "Marks entry per exam", "Graded directly against the class's configured scale"],
  },
  {
    icon: Layers,
    title: "Academic Structure",
    audience: "Admins & Teachers",
    description:
      "Subjects, classes, streams, and the academic calendar reflect Kenya's actual grade structure — not a generic \"Grade 1–12\" template built for a different country's school year.",
    capabilities: ["Kenyan CBC-aligned grade structure", "Subjects, classes, and streams setup", "Academic calendar by term"],
  },
  {
    icon: FileSpreadsheet,
    title: "NEMIS Reporting",
    audience: "Admins",
    description:
      "Generates NEMIS's ministry-format bulk-upload file straight from your student records instead of building it by hand. NEMIS has no public submission API for schools, so the file still gets uploaded through the NEMIS portal yourself — EduCore prepares it and tracks that it's done.",
    capabilities: ["Ministry-format bulk-upload file, generated automatically", "Built from existing student records, not re-entered"],
  },
];

export default function CbcSchoolManagementPage() {
  return (
    <>
      <Section tone="navy" className="pt-16 sm:pt-20">
        <Reveal>
          <Eyebrow tone="light">CBC &amp; Competency-Based Curriculum</Eyebrow>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            A CBC school management system that doesn&rsquo;t force out numeric grading.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/70">
            Most systems pick one grading model and make every class fit it.
            EduCore lets a school run CBC competency bands and numeric
            grading side by side — set per school, grade, or class — because
            most Kenyan schools genuinely need both during the transition.
          </p>
        </Reveal>
      </Section>

      <Section tone="canvas">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
          <div>
            <Reveal>
              <Eyebrow tone="dark">Set Per Class, Not School-Wide</Eyebrow>
              <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight text-marketing-navy-950 sm:text-4xl">
                Grade 4 on CBC bands. Form 3 on numeric marks. Same platform.
              </h2>
              <p className="mt-4 max-w-xl text-marketing-navy-900/70">
                A grading scale — CBC or numeric — is configured per school,
                grade, or class, with its own custom bands. A teacher marking
                a CBC class enters marks against that class&apos;s
                competency bands directly; a teacher marking a numeric class
                enters a percentage. Neither is retrofitted onto the other.
              </p>
            </Reveal>
          </div>
          <Reveal delayMs={150} className="hidden lg:block">
            <MiniFrame path="app.educore.io/exams/grading-scales">
              <p className="text-[11px] font-medium text-foreground">Grading scales</p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {[
                  { name: "CBC Competency Bands", classes: "Grade 4–6", model: "cbc" as const },
                  { name: "KCSE Numeric Marks", classes: "Form 3–4", model: "numeric" as const },
                ].map((row) => (
                  <div
                    key={row.name}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5"
                  >
                    <div>
                      <p className="text-[10px] font-medium text-foreground">{row.name}</p>
                      <p className="text-[9px] text-muted-foreground">{row.classes}</p>
                    </div>
                    <Badge variant="secondary" className="font-mono text-[9px] uppercase">
                      {row.model}
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
            Built around Kenya&rsquo;s curriculum, not adapted to it.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CBC_MODULES.map((m, i) => (
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
            <BookOpen className="mt-0.5 h-5 w-5 flex-shrink-0 text-marketing-blue" strokeWidth={1.75} />
            <div>
              <p className="text-sm font-semibold text-marketing-navy-950">
                Same student record, either grading model
              </p>
              <p className="mt-1 text-sm leading-relaxed text-marketing-navy-900/65">
                Marks entered under either scale live on the same{" "}
                <Link href="/student-management-system" className="text-marketing-blue underline underline-offset-2">
                  student record
                </Link>{" "}
                as attendance, fees, and discipline — see the full{" "}
                <Link href="/platform" className="text-marketing-blue underline underline-offset-2">
                  platform
                </Link>
                .
              </p>
            </div>
          </div>
        </Reveal>
      </Section>

      <Section tone="navy">
        <Reveal className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <Eyebrow tone="light">Get Started</Eyebrow>
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            See CBC and numeric grading set up for your own classes.
          </h2>
          <p className="max-w-xl text-white/70">
            A demo walks through your school&rsquo;s actual grade structure,
            not a generic sample school.
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
