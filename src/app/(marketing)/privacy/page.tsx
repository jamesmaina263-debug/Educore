import type { Metadata } from "next";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";

const TITLE = "Privacy Policy — EduCore";
const DESCRIPTION =
  "How EduCore collects, stores, and uses information submitted through this marketing website.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/privacy" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/privacy" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Every statement on this page describes something verifiable in the
// codebase as of this writing (contact/actions.ts, the
// marketing_demo_requests migration, instrumentation-client.ts) -- nothing
// here is a legal template filled with generic boilerplate, and nothing
// claims a compliance status that hasn't actually been reviewed. This is
// explicitly flagged as pending qualified legal review before it should be
// treated as a final, binding policy -- see the notice below.
export default function PrivacyPage() {
  return (
    <>
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Legal</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          This page explains what happens to information you submit through
          this marketing website. It does not cover the separate EduCore
          school-management application used by enrolled schools, which
          operates under its own data-handling agreement with each school.
        </p>
      </Section>

      <Section tone="canvas">
        <div className="mx-auto max-w-3xl space-y-10">
          <div className="rounded-2xl border border-marketing-gold-500/30 bg-marketing-gold-500/10 p-6 text-sm leading-relaxed text-marketing-navy-950">
            <p className="font-semibold">Legal review notice</p>
            <p className="mt-2 text-marketing-navy-900/80">
              This policy is a factual description of current data practices
              on this website, written for transparency ahead of launch. It
              has not yet been reviewed by qualified legal counsel and should
              not be treated as a final, legally binding document. It will be
              updated once that review is complete, including consideration
              of Kenya&apos;s Data Protection Act, 2019.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-marketing-navy-950">
              What we collect
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              If you submit the contact/demo request form on this site, we
              collect the information you provide: your name, school name,
              role, email address, and phone number and message if you choose
              to include them. If you arrived via a marketing link containing
              campaign parameters (for example, from an ad or a shared
              link), we also record which campaign referred you at the time
              you submit the form, so we understand which channels are
              helpful. Separately, simply browsing this site generates
              aggregate, non-identifying analytics — see &quot;Analytics&quot;
              below for what that covers.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-marketing-navy-950">
              How we store it
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              Demo request submissions are stored in a dedicated database
              table, separate from any school&apos;s student, academic, or
              financial records. The public website can only write new
              submissions to this table, never read them back. A small
              number of EduCore staff can read submissions, restricted to
              those with platform-administrator access, solely to follow up
              on your enquiry.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-marketing-navy-950">
              How we use it
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              We use the details you submit solely to respond to your
              enquiry and arrange a demo or answer your question. We do not
              sell this information, and we do not use it for advertising.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-marketing-navy-950">
              Error monitoring
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              This site uses Sentry to detect and diagnose technical errors.
              Default collection of personal data (such as IP addresses) is
              deliberately switched off in this configuration; Sentry
              receives only what is needed to identify and fix bugs.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-marketing-navy-950">
              Analytics
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              This site is built to use Plausible, a privacy-focused
              analytics service, to understand overall traffic and which
              pages and links are useful — but analytics collection is not
              switched on as of this writing. Once it is enabled, Plausible
              will not use cookies, will not track you individually across
              visits or across other websites, and will not collect your
              name, email, IP address, or any other personal information.
              It records only aggregate, anonymous information: which pages
              were viewed, roughly how many people visited, the general
              region and device type visitors are browsing from, and
              whether certain links were clicked (for example,
              &quot;Book a Demo&quot;, WhatsApp, or email links, and
              starting to fill in the demo request form). None of this can
              be tied back to you as an individual. This page will be
              updated to confirm once analytics is actually live.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-marketing-navy-950">
              Cookies
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              This marketing website does not set analytics or advertising
              cookies. The Plausible analytics described above works without
              cookies, so activating it will not change this. If that ever
              changes, this page will be updated first.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-marketing-navy-950">
              Contact
            </h2>
            <p className="mt-3 text-marketing-navy-900/75">
              Questions about this policy or a request to access or delete
              information you submitted can be sent through the{" "}
              <a href="/contact" className="text-marketing-blue underline underline-offset-2">
                contact form
              </a>
              .
            </p>
          </div>

          <p className="text-xs text-marketing-navy-900/50">
            Last updated: this page reflects the current codebase as of
            launch preparation and will be revised as the site or its data
            practices change.
          </p>
        </div>
      </Section>
    </>
  );
}
