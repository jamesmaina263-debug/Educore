"use client";

// Captures which on-site CTA (page + visible label + an optional named
// variant, e.g. a pricing tier) sent the visitor toward /contact -- purely
// so a completed demo request can be tied back to the specific link that
// drove it. Never sent to the server or stored in Supabase -- read once at
// /contact mount and pushed straight into dataLayer for GTM/GA4, same as
// src/lib/attribution.ts's UTM capture.
//
// Last-click wins (unlike attribution.ts's first-touch UTM capture): if a
// visitor clicks a second CTA before actually submitting, the newer click
// is what's credited, since that's the CTA that actually convinced them
// this time.
const STORAGE_KEY = "educore_cta_source";

export type CtaSource = {
  location?: string;
  label?: string;
  tier?: string;
};

// Called from the delegated click handler in analytics.tsx the instant a
// /contact link is clicked -- runs synchronously before the browser
// navigates, so the write always completes in time.
export function captureCtaSource(source: CtaSource) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(source));
  } catch {
    // sessionStorage can throw in some privacy modes/browsers -- this is a
    // nice-to-have, never worth breaking navigation over.
  }
}

// Reads back whatever CTA context was captured just before this page load.
// Returns an empty object if none was captured, or storage is unavailable.
export function getStoredCtaSource(): CtaSource {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CtaSource) : {};
  } catch {
    return {};
  }
}
