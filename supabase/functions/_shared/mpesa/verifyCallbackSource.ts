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
// these, without a redeploy. Set MPESA_CALLBACK_IP_ALLOWLIST_ENFORCE=false to skip the check
// for SANDBOX schools only (e.g. testing from a non-Safaricom IP). The callback handler ignores
// the flag for any school whose mpesa_settings.environment is not 'sandbox', so it cannot be
// left off for real money by accident. Every callback still logs a warning while it is off.

import { getRealClientIp } from "../getRealClientIp.ts";

// 196.201.212.0/24 added 2026-10-03: after the cf-connecting-ip fix, production logs showed genuine
// Daraja callbacks arriving from 196.201.212.69 (Safaricom's published Daraja egress list includes
// several 196.201.212.x hosts alongside the .213/.214 ones) and being rejected by the old two-range list.
const DEFAULT_ALLOWLIST = ["196.201.214.0/24", "196.201.213.0/24", "196.201.212.0/24"];

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

// SECURITY FIX: this used to read the FIRST entry of x-forwarded-for, on the reasoning that
// Supabase's edge appends to (rather than replaces) the header. That reasoning was actually an
// argument for the opposite conclusion -- see getRealClientIp.ts. Reading the first entry meant
// this allowlist check could be bypassed entirely by anyone who could set an X-Forwarded-For
// header on their request (i.e. anyone), which defeated the "still has to originate from inside
// Safaricom's network" guarantee this file's own comments claim it provides.
//
// FOLLOW-UP FIX: the LAST X-Forwarded-For entry is only the real caller when the trusted edge is
// the final hop. For Daraja callbacks an extra intermediary now appends its own address after
// Safaricom's, so the last entry was e.g. 13.248.120.200 while the true caller was
// 196.201.214.200 -- every genuine callback was rejected (and the STK request stayed 'pending'
// forever). Supabase's edge is fronted by Cloudflare, which SETS cf-connecting-ip itself and
// overwrites any client-supplied value, so it is the trustworthy source when present. If it is
// absent we fall back to the previous behaviour unchanged.
function getSourceIp(req: Request): string | null {
  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfIp && ipToInt(cfIp) !== null) return cfIp;
  return getRealClientIp(req);
}

export interface CallbackSourceCheck {
  allowed: boolean;
  sourceIp: string | null;
  enforced: boolean;
  // Result of the allowlist check itself, computed even when enforcement is switched off, so the
  // caller can still insist on it for non-sandbox schools (see mpesa-stk-callback/index.ts).
  inAllowlist: boolean;
}

export function verifyCallbackSource(req: Request): CallbackSourceCheck {
  const enforced = Deno.env.get("MPESA_CALLBACK_IP_ALLOWLIST_ENFORCE") !== "false";
  const allowlist = (Deno.env.get("MPESA_CALLBACK_IP_ALLOWLIST") ?? DEFAULT_ALLOWLIST.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const sourceIp = getSourceIp(req);

  // Fail closed: a payment webhook with no determinable source IP is treated the same as one
  // from an unrecognized IP, not silently let through.
  const inAllowlist = sourceIp !== null && allowlist.some((cidr) => ipInCidr(sourceIp, cidr));

  if (!enforced) {
    return { allowed: true, sourceIp, enforced: false, inAllowlist };
  }

  return { allowed: inAllowlist, sourceIp, enforced: true, inAllowlist };
}
