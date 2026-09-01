// Supabase's edge network (and edge proxies generally, per the Envoy `use_remote_address: true`
// pattern Supabase's own gateway docs describe) does not trust client-supplied X-Forwarded-For --
// it APPENDS the connection's real peer IP as a new entry rather than replacing the header. That
// means:
//   - The LAST entry is the one the trusted edge itself observed and added -- this is the real
//     source IP, not attacker-controllable.
//   - Every entry before that (including the first) is whatever the client put in the header
//     when it made the request, which is exactly as trustworthy as any other client input: not
//     at all. A caller can set `X-Forwarded-For: 1.2.3.4` and that value will appear as the FIRST
//     entry, with the real connecting IP appended after it by the edge.
//
// Taking the first entry (a bug that existed in three functions in this codebase until this file
// was added) silently defeats anything built on top of it: an IP allowlist becomes bypassable by
// anyone who can set a header, and a per-IP rate limit becomes bypassable by sending a different
// fake first entry on every request.
export function getRealClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return null;
  const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return parts[parts.length - 1];
}
