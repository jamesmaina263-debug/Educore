type MaybeAuthError =
  | {
      message?: string;
      code?: string;
      context?: { status?: number };
    }
  | null
  | undefined;

// Supabase's gateway occasionally rejects the very first request of a concurrent burst with
// "JWT issued at future" (PostgREST error code PGRST303 on .rpc() calls) or a bare 401 at the
// Edge Functions gateway (on .functions.invoke() calls) -- a transient clock-skew blip on
// Supabase's side, not a bad or rotated credential. Confirmed live across three separate cron
// failures on 2026-09-23 (billing, school-comms, dispatch-communications): the identical
// service-role token succeeded again a few milliseconds later on the very next call in the same
// invocation. One retry clears it.
function isTransientAuthError(error: MaybeAuthError): boolean {
  if (!error) return false;
  if (error.code === "PGRST303") return true;
  if (error.context?.status === 401) return true;
  return false;
}

// Runs fn(), and if it fails with a transient gateway auth error, runs it exactly once more
// before handing the result back to the caller. Only ever retries the specific transient-auth
// signature above -- a real permission failure, validation error, or anything else is returned
// as-is on the first try. Safe for any Supabase call whose fn is safe to run twice (every call
// this wraps today is a service-role .rpc()/.functions.invoke() against an idempotent sweep).
export async function withTransientAuthRetry<T extends { error: MaybeAuthError }>(
  fn: () => PromiseLike<T>,
): Promise<T> {
  const first = await fn();
  if (isTransientAuthError(first.error)) {
    return await fn();
  }
  return first;
}
