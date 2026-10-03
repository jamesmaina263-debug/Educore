// Validates a post-auth `next` redirect target so it can only ever point at
// a path on this same app. Without this, `${origin}${next}` is an open
// redirect: `?next=@evil.com` builds `https://app@evil.com`, which browsers
// treat as a request to evil.com with `app` as the username.
//
// Accepts only values that start with a single "/" (e.g. "/reset-password",
// "/dashboard?tab=1"). Anything else -- absolute URLs, protocol-relative
// ("//host"), backslash tricks ("/\host"), "@host", control characters --
// falls back to `fallback`.
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;

  try {
    const base = "http://safe-next.invalid";
    if (new URL(next, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
