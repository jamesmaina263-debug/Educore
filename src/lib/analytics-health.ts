// Decides whether the admin analytics page should warn that its two visit counters disagree.
// Pure and server-safe so it can be unit tested. Nothing here is estimated: it only compares
// numbers the page already has (Google Analytics' report vs. our own first-party counter).

export type AnalyticsHealthInput = {
  /** GA4 service-account env vars are present. */
  gaConfigured: boolean;
  /** GA4 report visitors for the range; null when the request failed. */
  gaVisitors: number | null;
  /** Our own counter's visitors for the range; null when its database function was unavailable. */
  firstPartyVisitors: number | null;
  /** The selected range ends today (Kenya time), so GA4's batch processing may not have caught up. */
  endsToday: boolean;
};

export type AnalyticsHealth =
  | { status: "ok" }
  | { status: "ga-not-configured" | "ga-error" | "counter-unavailable" | "ga-lagging" | "ga-missing"; message: string };

/**
 * ok              - nothing worth saying, the banner is hidden.
 * ga-lagging      - GA4 shows nothing yet but we saw visitors, and the range includes today: expected delay.
 * ga-missing      - same, but for a finished range: GA4 should have caught up, so hits are probably not arriving.
 */
export function assessAnalyticsHealth(input: AnalyticsHealthInput): AnalyticsHealth {
  const { gaConfigured, gaVisitors, firstPartyVisitors, endsToday } = input;

  if (!gaConfigured) {
    return {
      status: "ga-not-configured",
      message: "Google Analytics is not connected, so the Website Analytics numbers are unavailable. Our own counter below still works.",
    };
  }
  if (gaVisitors === null) {
    return {
      status: "ga-error",
      message: "Google Analytics could not be reached just now, so those cards show a dash. Our own counter below is unaffected.",
    };
  }
  if (firstPartyVisitors === null) {
    return {
      status: "counter-unavailable",
      message: "Our own visit counter could not be loaded, so Google Analytics can't be cross-checked right now.",
    };
  }
  if (gaVisitors === 0 && firstPartyVisitors > 0) {
    return endsToday
      ? {
          status: "ga-lagging",
          message: `Our own counter recorded ${firstPartyVisitors.toLocaleString()} visitor${firstPartyVisitors === 1 ? "" : "s"} but Google Analytics shows none yet. Google processes reports in batches and can trail by hours, so this usually clears on its own. Check Yesterday to confirm Google is receiving data.`,
        }
      : {
          status: "ga-missing",
          message: `Our own counter recorded ${firstPartyVisitors.toLocaleString()} visitor${firstPartyVisitors === 1 ? "" : "s"} in this period but Google Analytics shows none. That range is finished, so the delay doesn't explain it: check that the Google Tag Manager container is published and that the GA4 tag fires.`,
        };
  }
  return { status: "ok" };
}
