import * as Sentry from "@sentry/nextjs";

// DSN is not a secret (Sentry DSNs are designed to be embedded in client bundles) — the literal
// fallback here means error reporting works immediately after deploy without depending on a
// Vercel dashboard env-var step. NEXT_PUBLIC_SENTRY_DSN, if set, overrides it (e.g. to point a
// staging environment at a different Sentry project later).
const DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  "https://ced03b19370ddddee526114ae0221b91@o4511868701114368.ingest.de.sentry.io/4511868708716624";

Sentry.init({
  dsn: DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  // Deliberately NOT enabling sendDefaultPii: this app handles minors' data (students, guardians)
  // and the Kenya Data Protection Act 2019 compliance review named in the gap analysis (Tier 1
  // #3) hasn't happened yet. Default-on PII capture (IP addresses, headers) is exactly the kind
  // of thing that review needs to sign off on first, not something a Sentry setup should assume.
  sendDefaultPii: false,
  // Error monitoring only for now, no performance tracing — this is what the gap analysis asked
  // for ("you need to know when production breaks"), and it keeps volume low on the free tier.
  tracesSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
