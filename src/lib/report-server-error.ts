import * as Sentry from "@sentry/nextjs";

interface ServerErrorContext {
  /** Dotted action identifier, e.g. "finance.recordPayment" -- becomes a Sentry tag and shows
   * up in the structured log line, so a failure can be found by "what were they doing" alone. */
  action: string;
  schoolId?: string | null;
  userId?: string | null;
  /** Small, non-PII key/value pairs relevant to the failure (an invoice id, a status code).
   * Same posture as security-alert.ts: identifiers to act on, not full record contents. */
  extra?: Record<string, string | number | null | undefined>;
}

/**
 * Reports a server-side error that's being CAUGHT and turned into a `{ error }` return value
 * rather than thrown. This distinction matters: Sentry's automatic Next.js instrumentation only
 * captures thrown/unhandled exceptions. An audit of this codebase found ~35 of 46 Server Action
 * files catch Supabase/RPC errors and return them to the UI as a plain value on every failure
 * path -- which means Sentry silently sees none of them, no matter how well Sentry itself is
 * configured. Call this at each such catch site instead of (or alongside) returning the error,
 * so "which school, which user, which action, what failed, when" is answerable after the fact
 * instead of only "the user saw a generic error banner."
 *
 * Deliberately fail-safe and synchronous-looking (fire-and-forget internally): mirrors
 * security-alert.ts's stance that an observability failure must never throw, block, or slow down
 * the request it's attached to. Also always logs a structured, single-line JSON console.error --
 * that line lands in Vercel's function logs and is searchable/gradable even in an environment
 * where SENTRY_DSN isn't set, Sentry is rate-limiting, or the ingest call itself fails.
 */
export function reportServerError(error: unknown, context: ServerErrorContext): void {
  const message = error instanceof Error ? error.message : String(error);

  console.error(
    JSON.stringify({
      level: "error",
      action: context.action,
      school_id: context.schoolId ?? null,
      user_id: context.userId ?? null,
      message,
      extra: context.extra ?? undefined,
      at: new Date().toISOString(),
    }),
  );

  try {
    Sentry.captureException(error instanceof Error ? error : new Error(message), {
      tags: {
        action: context.action,
        ...(context.schoolId ? { school_id: context.schoolId } : {}),
      },
      user: context.userId ? { id: context.userId } : undefined,
      extra: context.extra,
    });
  } catch {
    // An observability failure is not a reason to affect the caller -- the console.error above
    // already ran regardless of whether this Sentry call succeeds.
  }
}
