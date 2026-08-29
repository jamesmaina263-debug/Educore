import type * as SentryNS from "@sentry/nextjs";
import { isMarketingPath } from "@/lib/marketing-routes";

// DSN is not a secret (Sentry DSNs are designed to be embedded in client bundles) — the literal
// fallback here means error reporting works immediately after deploy without depending on a
// Vercel dashboard env-var step. NEXT_PUBLIC_SENTRY_DSN, if set, overrides it (e.g. to point a
// staging environment at a different Sentry project later).
const DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  "https://ced03b19370ddddee526114ae0221b91@o4511868701114368.ingest.de.sentry.io/4511868708716624";

// Marketing pages (Phase 9/10 audit finding): a static top-level `import * as Sentry from
// "@sentry/nextjs"` here would ship the SDK to every route's first-load JS, including the
// anonymous, unauthenticated, no-mutation-besides-the-server-side-demo-form marketing pages that
// make up the overwhelming majority of first-time visits. Marketing errors (a broken layout, a
// failed fetch) are also far less actionable/urgent than an app error touching fee balances or
// medical records. So: only import and initialize Sentry for non-marketing routes, and load it
// lazily via dynamic import so the bytes never reach the marketing bundle at all. App routes keep
// exactly the same coverage as before -- this only removes Sentry from the marketing surface.
let sentryModule: typeof SentryNS | null = null;
let loading: Promise<typeof SentryNS> | null = null;

function loadSentry(): Promise<typeof SentryNS> {
  if (!loading) {
    loading = import("@sentry/nextjs").then((Sentry) => {
      Sentry.init({
        dsn: DSN,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
        // Same PII stance as sentry.server.config.ts -- see that file's comment. This app
        // handles minors' data (students, guardians) and the Kenya Data Protection Act 2019
        // review named in the gap analysis hasn't happened yet.
        sendDefaultPii: false,
        // Error monitoring only for now, no performance tracing -- keeps volume low on the
        // free tier and matches the server-side configs.
        tracesSampleRate: 0,
      });
      sentryModule = Sentry;
      return Sentry;
    });
  }
  return loading;
}

if (typeof window !== "undefined" && !isMarketingPath(window.location.pathname)) {
  void loadSentry();
}

// Next.js 15+ client instrumentation hook, called at the start of every client-side navigation
// with the destination href. Used here to lazily bring Sentry in the moment a marketing visitor
// navigates *toward* a non-marketing route (e.g. clicking "Log in") -- so a session that started
// on the marketing site still gets full error coverage once it enters the app, without having
// paid the bundle cost on the marketing pages that came before it. Marketing-to-marketing
// navigation (the common case: clicking between nav links) stays a true no-op -- nothing is
// imported and no span is recorded, since tracesSampleRate is 0 everywhere anyway.
export function onRouterTransitionStart(href: string, navigationType: string) {
  if (sentryModule) {
    sentryModule.captureRouterTransitionStart(href, navigationType);
    return;
  }
  let destinationPath = href;
  try {
    destinationPath = new URL(href, window.location.origin).pathname;
  } catch {
    // Malformed/relative href we can't parse -- fall through and treat it as non-marketing
    // (safer default: still get error coverage) rather than silently dropping it.
  }
  if (!isMarketingPath(destinationPath)) {
    void loadSentry().then((Sentry) => Sentry.captureRouterTransitionStart(href, navigationType));
  }
}
