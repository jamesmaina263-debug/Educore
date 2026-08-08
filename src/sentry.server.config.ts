import * as Sentry from "@sentry/nextjs";

const DSN =
  process.env.SENTRY_DSN ??
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  "https://ced03b19370ddddee526114ae0221b91@o4511868701114368.ingest.de.sentry.io/4511868708716624";

Sentry.init({
  dsn: DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  // Same PII stance as the client config — see instrumentation-client.ts's comment. This matters
  // even more server-side, since Server Actions here handle fee balances, medical records, and
  // payroll, not just page errors.
  sendDefaultPii: false,
  tracesSampleRate: 0,
});
