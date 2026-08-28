// Safaricom's Daraja API has no per-request signature the way Twilio does (see
// verifyTwilioSignature.ts for the contrast) -- there is no shared secret Safaricom signs
// callbacks with, so "verify this really came from Safaricom" can't be done cryptographically.
// The primary defense stays the callback_token in the URL path (see mpesa-stk-callback/index.ts)
// -- a random, per-school secret an attacker has to already know before this check even runs.
//
// This adds IP allowlisting as a second, independent layer: Safaricom's own integration guidance
// recommends it, and their published callback source ranges are stable and narrow. It closes the
// specific residual risk a callback-token-only design has -- if that URL ever leaked (logs, a
// screenshot, a misconfigured proxy, a support ticket pasted somewhere), an attacker still has to
// originate the request from inside Safaricom's network to get past this check, not just know
// the URL. IP spoofing over a real TCP+TLS connection is impractical, so this is a meaningful
// barrier, not security theater -- but it's still not cryptographic proof of origin the way an
// HMAC signature is, which is why the callback_token check is not being removed or weakened.
//
// Ranges below are Safaricom's publicly documented Daraja callback source IPs as of 2026.
// Override via MPESA_CALLBACK_IP_ALLOWLIST (comma-separated CIDR blocks) if Safaricom changes
// these, without a redeploy. Set MPESA_CALLBACK_IP_ALLOWLIST_ENFORCE=false to disable entirely
// (e.g. sandbox testing from a non-Safaricom IP) -- every callback logs a warning while disabled
// so it can't be silently left off in production.

const DEFAULT_ALLOWLIST = ["196.201.214.0/24", "196.201.213.0/24"];

function parseCidr(cidr: string): { base: number; mask: number } | null {
  const [ip, bitsStr] = cidr.trim().split("/");
  const bits = bitsStr !== undefined ? parseInt(bitsStr, 10) : 32;
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return null;
  const base = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { base, mask };
}

function ipToInt(ip: string): number | null {
  const parts = ip.trim().split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const parsedCidr = parseCidr(cidr);
  const ipInt = ipToInt(ip);
  if (!parsedCidr || ipInt === null) return false;
  return (ipInt & parsedCidr.mask) === (parsedCidr.base & parsedCidr.mask);
}

// x-forwarded-for's first entry is the original client IP as seen by the first proxy hop in
// front of this function. Supabase's edge network appends to (rather than replaces) this header,
// so the first entry is the one that matters here, not the last.
function getSourceIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return null;
  return xff.split(",")[0]?.trim() || null;
}

export interface CallbackSourceCheck {
  allowed: boolean;
  sourceIp: string | null;
  enforced: boolean;
}

export function verifyCallbackSource(req: Request): CallbackSourceCheck {
  const enforced = Deno.env.get("MPESA_CALLBACK_IP_ALLOWLIST_ENFORCE") !== "false";
  const allowlist = (Deno.env.get("MPESA_CALLBACK_IP_ALLOWLIST") ?? DEFAULT_ALLOWLIST.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const sourceIp = getSourceIp(req);

  if (!enforced) {
    return { allowed: true, sourceIp, enforced: false };
  }

  if (!sourceIp) {
    // Fail closed: a payment webhook with no determinable source IP is treated the same as one
    // from an unrecognized IP, not silently let through.
    return { allowed: false, sourceIp: null, enforced: true };
  }

  const allowed = allowlist.some((cidr) => ipInCidr(sourceIp, cidr));
  return { allowed, sourceIp, enforced: true };
}
