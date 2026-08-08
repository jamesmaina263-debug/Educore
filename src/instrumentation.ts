import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Next.js 15+ hook for errors thrown during Server Component rendering / data fetching that
// wouldn't otherwise reach a try/catch — this is where most of this app's Server Actions and
// server-rendered pages will actually surface a crash.
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
