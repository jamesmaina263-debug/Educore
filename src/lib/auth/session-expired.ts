// Shared handling for "the server action ran without a valid user session".
//
// Background (production logs, 2026-10-30): the Next.js server called the PostgREST RPC
// auth_school_id() with only the public API key and no user token, so the database saw role
// `anon` and answered 401 / SQLSTATE 42501 "permission denied for function auth_school_id".
// That is by design -- anon's EXECUTE on this helper is revoked (see the phase0 / m2 revoke
// migrations and the anon-execute drift check) -- so 42501 from THIS function means one thing:
// the request carried no valid session (expired, signed out elsewhere, or refresh failed).
//
// Before this helper every caller reported that as "Could not resolve your school.", which sends
// the user hunting for a school/configuration problem when all they need to do is sign in again.
// Callers keep their existing return/throw shape and only the message changes, because the
// throwing helpers are called inside try/catch blocks that return e.message to the UI (a
// redirect() thrown from them would be swallowed by those catches).

export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
export const SCHOOL_NOT_RESOLVED_MESSAGE = "Could not resolve your school.";

// SQLSTATE 42501 = insufficient_privilege. supabase-js surfaces PostgREST's `code` unchanged.
export function isSessionExpiredError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "42501";
}

// Message for a failed `supabase.rpc("auth_school_id")`. Pass the rpc's `error` (may be null when
// the call "succeeded" but returned no school, e.g. a platform admin -- that stays the old text).
export function schoolIdErrorMessage(error: { code?: string | null } | null | undefined): string {
  return isSessionExpiredError(error) ? SESSION_EXPIRED_MESSAGE : SCHOOL_NOT_RESOLVED_MESSAGE;
}
