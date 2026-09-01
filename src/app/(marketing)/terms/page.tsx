import type { Metadata } from "next";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";

const TITLE = "Terms of Service — EduCore";
const DESCRIPTION =
  "The terms that apply to using this marketing website and requesting a demo of EduCore.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/terms" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/terms" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// As with /privacy: factual, conservative, and explicitly flagged as
// pending legal review -- not a filled-in generic template presented as
// final. Separate from any subscription/order terms that will govern an
// actual paid school subscription, which do not exist publicly yet.
export default function TermsPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Terms of Service", path: "/terms" }]} />
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Legal</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Terms of Service
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          These terms cover use of this marketing website. They do not cover
          use of the EduCore school-management application itself, which is
          governed separately once a school signs up.
        </p>
      </Section>

      <Section tone="canvas">
        <div className="mx-auto max-w-3xl space-y-10">
          <div className="rounded-2xl border border-marketing-gold-500/30 bg-marketing-gold-500/10 p-6 text-sm leading-relaxed text-marketing-navy-950">
            <p className="font-semibold">Legal review notice</p>
            <p className="mt-2 text-marketing-navy-900/80">
              This page has not yet been reviewed by qualified legal counsel
              and should not be treated as a final, legally binding document.
              A more complete Terms of Service, including any that govern a
              paid EduCore subscription, will be published as those
              commercial terms are finalised.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-marketing-navy-950">
              Using this website
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              This website is provided to help schools learn about EduCore
              and request a demo. You&apos;re welcome to browse it and submit
              the contact form; please don&apos;t attempt to disrupt the
              site, submit false information intended to abuse the form, or
              attempt to access data that isn&apos;t yours.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-marketing-navy-950">
              No guarantee of features or pricing shown
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              Product capabilities, module names, and plan structures
              described on this site reflect EduCore as it currently exists
              and may change. Where a feature is described as planned rather
              than live, it is not yet available. Nothing on this site is a
              binding quote; actual commercial terms are agreed separately
              with your school.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-marketing-navy-950">
              Intellectual property
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              The EduCore name, logo, and the content of this site belong to
              EduCore and may not be reproduced without permission.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-marketing-navy-950">
              Contact
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              Questions about these terms can be sent through the{" "}
              <a href="/contact" className="text-marketing-blue underline underline-offset-2">
                contact form
              </a>
              .
            </p>
          </div>

          <p className="text-xs text-marketing-navy-900/50">
            Last updated: this page reflects the current codebase as of
            launch preparation and will be revised as the site changes.
          </p>
        </div>
      </Section>
    </>
  );
}
