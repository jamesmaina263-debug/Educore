// Captures attribution/CTA-source context for GTM and delegates click
// tracking to the shared dataLayer -- this used to also load a Plausible
// script as a second, cookie-less analytics tool, but Plausible was never
// actually activated (NEXT_PUBLIC_PLAUSIBLE_DOMAIN was never set) and GA4
// (via GTM-MGV2XHBB) is the live analytics source the admin dashboard
// reads from -- see src/lib/ga4.ts and src/app/(admin)/admin/analytics.
// Removed rather than finished: keeping two parallel, mostly-unconfigured
// tracking paths was more surface area than value. See /privacy Section
// "Error monitoring, analytics, and cookies" for the current, accurate
// statement of what sets cookies (GA4/GTM does, on marketing pages only).
"use client";

import { useEffect } from "react";
import { captureAttribution } from "@/lib/attribution";
import { captureCtaSource } from "@/lib/cta-source";

export function MarketingAnalytics() {
  // Attribution capture runs on every marketing-page mount. This is what
  // lets a demo-request submission be traced back to a channel/campaign --
  // see src/lib/attribution.ts.
  useEffect(() => {
    captureAttribution();
  }, []);

  // CTA click tracking: a single delegated listener here (this component is
  // already mounted on every marketing page via the shared layout) rather
  // than instrumenting each of the ~12 "Book a Demo" / "Contact" links
  // individually across every marketing page -- far less edit surface, and
  // automatically covers any new CTA added later without extra wiring.
  // Attributes each click to the page it was clicked from (location) and
  // the link's own visible text (label).
  //
  // Covers three link shapes: /contact (the form), wa.me (WhatsApp -- also
  // the link the visible phone number itself uses, there is no separate
  // tel: link), and mailto: (email). No "Phone Click" event exists
  // separately from the WhatsApp click -- confirmed with the project owner
  // that the phone number stays a WhatsApp-only link.
  //
  // NOTE: captureCtaSource() only writes to sessionStorage (read back by
  // demo-request-form.tsx and pushed into dataLayer from there as
  // cta_location/cta_label/cta_tier on contact_form_context/
  // contact_form_submit) -- it does not itself send a named click event to
  // GTM. The admin analytics page's "CTA Clicks" and "Demo Form Started"
  // funnel rows (src/app/(admin)/admin/analytics/page.tsx) read GA4 goal
  // names ("Contact CTA Click", "WhatsApp CTA Click", "Email CTA Click",
  // "Demo Form Started") that nothing currently sends -- those were
  // previously fired only to Plausible's window.plausible(), which never
  // ran (domain never configured). Removing that call here doesn't change
  // those funnel rows' behavior; they were already unpopulated. Sending
  // those as real GTM dataLayer events (matching the contact_form_submit
  // pattern in demo-request-form.tsx) is a separate, real follow-up if
  // that funnel-stage data is wanted.
  useEffect(() => {
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

      // GTM/GA4-specific: stash which page/label (and, for pricing-tier
      // CTAs, which tier -- see data-cta-tier in pricing-card.tsx) sent
      // them to /contact. demo-request-form.tsx reads this back at mount
      // and pushes it into dataLayer, so the eventual contact_sales/
      // generate_lead GA4 event can carry "which CTA drove this" context.
      // Never sent to the server.
      if (eventName === "Contact CTA Click") {
        const label = anchor.textContent?.trim().replace(/\s+/g, " ").slice(0, 60) || eventName;
        const location = window.location.pathname;
        const tier = anchor instanceof HTMLElement ? anchor.dataset.ctaTier : undefined;
        captureCtaSource({ location, label, tier });
      }
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
}
