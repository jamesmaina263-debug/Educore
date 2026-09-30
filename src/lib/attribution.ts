"use client";

// Lightweight first-touch marketing attribution capture. Deliberately
// independent of whether any analytics platform is configured -- this
// exists purely so a submitted demo-request lead, checklist download or
// trial signup can be traced back to the channel/campaign (and, for Google
// Ads, the ad click) that brought the visitor in, and works even if GA4
// (GOOGLE_SERVICE_ACCOUNT_JSON/GA4_PROPERTY_ID) is never configured.
//
// First-touch, not last-touch: once attribution is captured for this
// browser tab (sessionStorage), a later page visit without UTM params does
// NOT overwrite it -- so a visitor who arrives via a Google ad, clicks
// around the site, and lands on /contact several pages later still gets
// credited to that ad rather than showing up as "(direct)".
//
// What is captured is defined once in src/lib/marketing/attribution-fields.ts:
// the five UTM tags plus Google's click IDs (gclid, gbraid, wbraid). Click IDs
// are skipped entirely when the visitor has declined cookies (see
// src/lib/marketing/consent.ts) -- they exist only for advertising
// measurement, so a decline has to mean they are not stored.
import {
  ATTRIBUTION_KEYS,
  CLICK_ID_KEYS,
  isClickIdKey,
  sanitizeAttributionValue,
  type Attribution,
} from "@/lib/marketing/attribution-fields";
import { readConsentChoice } from "@/lib/marketing/consent";

export type { Attribution };

const STORAGE_KEY = "educore_attribution";

// External-store hooks so a component can read the captured attribution with
// useSyncExternalStore (nothing during server render, the stored values in the
// browser) and pick it up once captureAttribution() has run.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function subscribeToAttribution(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The stored attribution as a JSON string ("{}" when there is none). */
export function getAttributionSnapshot(): string {
  if (typeof window === "undefined") return "{}";
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

export const getServerAttributionSnapshot = () => "{}";

// Reads attribution params from the current URL and stores them in
// sessionStorage. Safe to call on every marketing page load: a no-op if the
// URL has none, and never overwrites an existing capture from earlier in the
// session (see first-touch note above). Also called from /signup, which has
// its own layout and so does not mount MarketingAnalytics.
export function captureAttribution() {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(STORAGE_KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const declined = readConsentChoice() === "declined";
    const attribution: Attribution = {};
    for (const key of ATTRIBUTION_KEYS) {
      if (declined && isClickIdKey(key)) continue;
      const value = sanitizeAttributionValue(key, params.get(key));
      if (value) attribution[key] = value;
    }
    if (Object.keys(attribution).length > 0) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
      notify();
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

// Called when a visitor declines cookies mid-session: drops any ad click ID
// already captured while keeping the (non-identifying) UTM campaign tags.
export function clearStoredClickIds() {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Attribution;
    for (const key of CLICK_ID_KEYS) delete stored[key];
    if (Object.keys(stored).length > 0) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    notify();
  } catch {
    // Same reasoning as captureAttribution: never worth breaking the page.
  }
}
