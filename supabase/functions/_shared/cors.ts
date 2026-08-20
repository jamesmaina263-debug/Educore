// Origins allowed to make cross-origin browser requests to these functions.
// Set via the ALLOWED_ORIGINS Edge Function secret (comma-separated, e.g.
// "https://app.educore.co.ke,https://educore-staging.vercel.app") --
// `supabase secrets set ALLOWED_ORIGINS=...`. See SECRETS_ROTATION_POLICY.md.
//
// A wildcard ("*") origin would let any third-party website script calls to
// these functions using a visitor's browser as the request origin -- for
// request-otp/verify-otp specifically that means triggering OTP sends (SMS
// cost abuse) or verification attempts against arbitrary phone numbers from
// someone else's browser tab, with no server involved on the attacker's
// side. CORS is a browser-enforced check only (it does nothing against a
// direct server-to-server or curl call), so this is one layer of defense
// alongside the server-side rate limiting in request-otp -- not a
// replacement for it.
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  console.warn(
    "[cors] ALLOWED_ORIGINS is not set -- every cross-origin browser request will be rejected. " +
      "Set it via `supabase secrets set ALLOWED_ORIGINS=https://your-app-domain`.",
  );
}

// Builds per-request CORS headers: reflects the caller's Origin back only if
// it's on the allowlist, otherwise omits Access-Control-Allow-Origin
// entirely so the browser blocks the response (fails closed, not open).
export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    // Response varies by request Origin -- prevents shared/proxy caches from
    // serving one caller's CORS headers to a different origin.
    "Vary": "Origin",
  };
  if (allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}
