import type { Metadata } from "next";
import { Mail, Clock, ShieldCheck, MessageCircle } from "lucide-react";

import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { DemoRequestForm } from "@/components/marketing/demo-request-form";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "Contact — EduCore";
const DESCRIPTION =
  "Book a demo or ask a question — tell us a bit about your school and we'll get back to you.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/contact" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/contact" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function ContactPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Contact", path: "/contact" }]} />
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Contact</Eyebrow>
        <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Tell us about your school. We&apos;ll take it from there.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/70">
          A few details are enough to get started — we&apos;ll follow up to
          set up a walkthrough shaped around how your school actually runs.
        </p>
      </Section>

      <Section tone="canvas">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <Reveal>
            <div className="flex flex-col gap-8">
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-marketing-blue" strokeWidth={1.75} />
                <div>
                  <p className="text-sm font-semibold text-marketing-navy-950">
                    Quick turnaround
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-marketing-navy-900/65">
                    We follow up on every submission to find a time that works.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-marketing-blue" strokeWidth={1.75} />
                <div>
                  <p className="text-sm font-semibold text-marketing-navy-950">
                    No obligation
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-marketing-navy-900/65">
                    A demo is a conversation, not a commitment — come with
                    questions.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-5 w-5 flex-shrink-0 text-marketing-blue" strokeWidth={1.75} />
                <div>
                  <p className="text-sm font-semibold text-marketing-navy-950">
                    One quick form
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-marketing-navy-900/65">
                    Just your name, school, role, and contact details — enough
                    for us to reach out and take it from there.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MessageCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-marketing-blue" strokeWidth={1.75} />
                <div>
                  <p className="text-sm font-semibold text-marketing-navy-950">
                    Prefer to reach us directly?
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-marketing-navy-900/65">
                    WhatsApp{" "}
                    <a
                      href="https://wa.me/254702904562"
                      className="font-medium text-marketing-blue underline underline-offset-2"
                    >
                      +254 702 904562
                    </a>{" "}
                    or email{" "}
                    <a
                      href="mailto:support@educoreafrica.com"
                      className="font-medium text-marketing-blue underline underline-offset-2"
                    >
                      support@educoreafrica.com
                    </a>
                    .
                  </p>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal>
            <div className="rounded-2xl border border-marketing-navy-950/10 bg-white p-6 shadow-sm sm:p-8">
              <DemoRequestForm />
            </div>
          </Reveal>
        </div>
      </Section>
    </>
  );
}
