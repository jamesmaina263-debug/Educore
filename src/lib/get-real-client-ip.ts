// Mirrors supabase/functions/_shared/getRealClientIp.ts (see that file's
// comment for the full explanation, and PR #172 for the Edge Function side
// of this fix).
//
// Vercel's edge network -- like Supabase's -- does not trust client-supplied
// X-Forwarded-For; it APPENDS the connection's real peer IP as a new entry
// rather than replacing the header. That means:
//   - The LAST entry is the one the trusted edge itself observed and added
//     -- this is the real source IP, not attacker-controllable.
//   - Every entry before that (including the first) is whatever the client
//     put in the header when it made the request: exactly as trustworthy as
//     any other client input, i.e. not at all.
//
// Reading the first entry (the bug this file fixes, in login/signup/contact/
// admission-application rate limiting) lets a caller bypass any IP-based
// rate limit or allowlist built on top of it just by sending a different
// fake first entry on every request.
export function getRealClientIp(headerValue: string | null): string {
  if (!headerValue) return "unknown";
  const parts = headerValue
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "unknown";
}
