"use client";

// Lightweight first-touch marketing attribution capture. Deliberately
// independent of whether Plausible (or any analytics platform) is
// configured -- this exists purely so a submitted demo-request lead can be
// traced back to the channel/campaign that brought the visitor in, and
// works even if NEXT_PUBLIC_PLAUSIBLE_DOMAIN is never set.
//
// First-touch, not last-touch: once attribution is captured for this
// browser tab (sessionStorage), a later page visit without UTM params does
// NOT overwrite it -- so a visitor who arrives via a Google ad, clicks
// around the site, and lands on /contact several pages later still gets
// credited to that ad rather than showing up as "(direct)".
const STORAGE_KEY = "educore_attribution";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

export type Attribution = Partial<Record<(typeof UTM_KEYS)[number], string>>;

// Reads UTM params from the current URL and stores them in sessionStorage.
// Safe to call on every marketing page load: a no-op if the URL has no UTM
// params, and never overwrites an existing capture from earlier in the
// session (see first-touch note above).
export function captureAttribution() {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(STORAGE_KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const attribution: Attribution = {};
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) attribution[key] = value.slice(0, 100);
    }
    if (Object.keys(attribution).length > 0) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
    }
  } catch {
    // sessionStorage can throw in some privacy modes/browsers -- attribution
    // is a nice-to-have, never worth breaking the page over.
  }
}

// Reads back whatever attribution was captured earlier in this session.
// Returns an empty object if none was captured, or storage is unavailable.
export function getStoredAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Attribution) : {};
  } catch {
    return {};
  }
}
