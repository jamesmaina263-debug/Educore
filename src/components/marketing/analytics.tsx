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

import { useEffect } from "react";
import Script from "next/script";
import { captureAttribution } from "@/lib/attribution";

const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
const PLAUSIBLE_SCRIPT_URL =
  process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL ??
  "https://plausible.io/js/script.outbound-links.js";

export function MarketingAnalytics() {
  // Attribution capture runs unconditionally, independent of whether
  // Plausible is configured -- see src/lib/attribution.ts. This is what
  // lets a demo-request submission be traced back to a channel/campaign
  // even before any analytics account exists.
  useEffect(() => {
    captureAttribution();
  }, []);

  // CTA click tracking: a single delegated listener here (this component is
  // already mounted on every marketing page via the shared layout) rather
  // than instrumenting each of the ~12 "Book a Demo" / "Contact" links
  // individually across every marketing page -- far less edit surface, and
  // automatically covers any new CTA added later without extra wiring.
  // Attributes each click to the page it was clicked from (location) and
  // the link's own visible text (label), so "nav Book a Demo" and "pricing
  // Book a Demo" show up distinctly in Plausible's custom-event breakdown
  // without needing per-CTA prop plumbing.
  //
  // Covers three link shapes, each its own event: /contact (the form),
  // wa.me (WhatsApp -- also the link the visible phone number itself uses,
  // there is no separate tel: link), and mailto: (email). No "Phone Click"
  // event exists separately from "WhatsApp CTA Click" -- confirmed with
  // the project owner that the phone number stays a WhatsApp-only link.
  useEffect(() => {
    if (!PLAUSIBLE_DOMAIN) return;

    function eventNameFor(href: string): string | null {
      if (href.startsWith("/contact")) return "Contact CTA Click";
      if (href.startsWith("https://wa.me/") || href.startsWith("http://wa.me/")) {
        return "WhatsApp CTA Click";
      }
      if (href.startsWith("mailto:")) return "Email CTA Click";
      return null;
    }

    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      const eventName = eventNameFor(href);
      if (!eventName) return;
      const label = anchor.textContent?.trim().replace(/\s+/g, " ").slice(0, 60) || eventName;
      trackEvent(eventName, { location: window.location.pathname, label });
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

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
