import type { Metadata } from "next";
import { Download } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";

// Landing page for the "Brochure:" link in outreach emails (src/lib/outbound/prospects.ts).
//
// Why a page and not a direct link to the PDF: a static PDF under /public never runs the marketing layout's
// page-view tracking, so a click from an email would be invisible. This page records the visit with the
// email's UTM tags (first-touch attribution, as for /signup and /contact), then hands over the PDF.
//
// It is a campaign page: noindex, and deliberately not in the sitemap. The PDF itself lives at
// /downloads/educore-brochure.pdf, so it can be replaced without touching code. Replace the file, keep the name.
const PDF_PATH = "/downloads/educore-brochure.pdf";

// MarketingButton is whitespace-nowrap with a fixed height, so a long label cannot wrap and widens the whole
// page on a phone (the page then scrolls sideways and the left edge is cut off). These classes let the label wrap
// and make both buttons fill the width on small screens.
const BUTTON_FIT = "h-auto min-h-12 w-full whitespace-normal py-3 text-center sm:w-auto";

export const metadata: Metadata = {
  title: "EduCore brochure — school management software for Kenya",
  description: "A six-page overview of EduCore, the school management system built for Kenyan schools.",
  alternates: { canonical: "/brochure" },
  robots: { index: false, follow: true },
};

export default function BrochurePage() {
  return (
    <Section tone="navy" className="pt-16 sm:pt-20">
      <Eyebrow tone="light">EduCore brochure</Eyebrow>
      <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
        School management software, built for Kenyan schools.
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
        A six-page overview of what EduCore covers: admissions, student records, fees with M-Pesa, attendance,
        communication, academics and more.
      </p>
      <div className="mt-8 flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <MarketingButton asChild size="lg" className={BUTTON_FIT}>
          <a href={PDF_PATH} download>
            <Download className="size-4 shrink-0" aria-hidden="true" />
            Download the brochure (PDF, 1.4 MB)
          </a>
        </MarketingButton>
        <MarketingButton asChild size="lg" variant="outline-on-dark" className={BUTTON_FIT}>
          <a href="/contact">Book a demo</a>
        </MarketingButton>
      </div>
      <p className="mt-6 text-sm text-white/50">
        Prefer to look first?{" "}
        <a href="/signup" className="underline underline-offset-4">
          Start the free 30-day trial
        </a>
        , no card required.
      </p>
    </Section>
  );
}
