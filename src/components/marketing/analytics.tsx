// Safe integration point for conversion/analytics tracking, deliberately a
// no-op until manually configured -- see the setup note below. Uses
// Plausible (cookie-less, no personal data collection, no consent banner
// required) rather than a cookie-based analytics platform, since this site
// has no cookie-consent UI yet (see /privacy: "does not currently set
// analytics cookies" -- adding one silently here would make that false).
//
// MANUAL SETUP REQUIRED (outside this codebase) to activate:
//   1. Create a Plausible account (or self-hosted instance) for the
//      production domain.
//   2. Set NEXT_PUBLIC_PLAUSIBLE_DOMAIN as a Vercel env var to that domain
//      (e.g. "educore.co.ke"). Not a secret -- safe to expose client-side.
//   3. Optionally set NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL if self-hosting
//      instead of using Plausible's default script host.
// Until step 2 is done, this component renders nothing and trackEvent()
// silently no-ops -- no third-party request is ever made.
"use client";

import Script from "next/script";

const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
const PLAUSIBLE_SCRIPT_URL =
  process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL ??
  "https://plausible.io/js/script.outbound-links.js";

export function MarketingAnalytics() {
  if (!PLAUSIBLE_DOMAIN) return null;

  return (
    <Script
      defer
      data-domain={PLAUSIBLE_DOMAIN}
      src={PLAUSIBLE_SCRIPT_URL}
      strategy="afterInteractive"
    />
  );
}

// Fires a named conversion event (e.g. "Demo Request Submitted"). No-ops
// safely if analytics isn't configured or the script hasn't loaded yet --
// callers never need to guard this themselves.
export function trackEvent(name: string, props?: Record<string, string | number>) {
  if (typeof window === "undefined") return;
  const plausible = (window as typeof window & {
    plausible?: (name: string, opts?: { props?: Record<string, string | number> }) => void;
  }).plausible;
  plausible?.(name, props ? { props } : undefined);
}
