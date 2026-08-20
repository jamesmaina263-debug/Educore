// Origins allowed to make cross-origin browser requests to this function.
// Set via the ALLOWED_ORIGINS Edge Function secret (comma-separated) --
// `supabase secrets set ALLOWED_ORIGINS=...`. See SECRETS_ROTATION_POLICY.md.
//
// This endpoint is bearer-API-key-authenticated, not cookie/session-based,
// so a permissive CORS origin doesn't leak an ambient credential the way it
// would for a cookie-authenticated endpoint -- a caller still needs the raw
// key regardless of origin. Locked down anyway for defense in depth and
// consistency with the other functions; third-party integrators calling
// this from their own backend (the expected integration pattern per the
// header comment in index.ts) are unaffected, since CORS only applies to
// browser-issued requests.
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
  if (allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}
