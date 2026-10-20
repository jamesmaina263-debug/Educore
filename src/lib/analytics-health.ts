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
  /**
   * The range ends today or yesterday (Kenya time). Google says standard reports can take 24 to 48 hours to
   * process, so a zero there is not yet a sign that data is missing.
   */
  mayStillBeProcessing: boolean;
};

export type AnalyticsHealth =
  | { status: "ok" }
  | { status: "ga-not-configured" | "ga-error" | "counter-unavailable" | "ga-lagging" | "ga-missing"; message: string };

/**
 * ok              - nothing worth saying, the banner is hidden.
 * ga-lagging      - GA4 shows nothing yet but we saw visitors, and the range ends today or yesterday: Google can take
 *                   24 to 48 hours to process standard reports, so this is expected.
 * ga-missing      - same, but the range ended more than a day ago: GA4 should have caught up, so hits are probably
 *                   not arriving (or are being filtered).
 */
export function assessAnalyticsHealth(input: AnalyticsHealthInput): AnalyticsHealth {
  const { gaConfigured, gaVisitors, firstPartyVisitors, mayStillBeProcessing } = input;

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
    return mayStillBeProcessing
      ? {
          status: "ga-lagging",
          message: `Our own counter recorded ${firstPartyVisitors.toLocaleString()} visitor${firstPartyVisitors === 1 ? "" : "s"} but Google Analytics shows none yet. Google can take 24 to 48 hours to process standard reports, so this usually clears on its own. The live panel below reads Google's Realtime feed, which is current.`,
        }
      : {
          status: "ga-missing",
          message: `Our own counter recorded ${firstPartyVisitors.toLocaleString()} visitor${firstPartyVisitors === 1 ? "" : "s"} in this period but Google Analytics shows none. That range ended more than a day ago, so processing delay does not explain it: check that Google Analytics Realtime shows a test visit, then look at its Data filters and that the Google Tag Manager container is published.`,
        };
  }
  return { status: "ok" };
}
