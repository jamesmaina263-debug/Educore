import { createHmac, timingSafeEqual } from "node:crypto";

// Verification and parsing for Resend webhooks. Resend signs deliveries with Svix: the signed content is
// "<svix-id>.<svix-timestamp>.<raw body>", HMAC-SHA256 with the base64 part of the "whsec_..." signing secret,
// sent as one or more space-separated "v1,<base64>" values. Pure and unit-tested.

export const SVIX_TOLERANCE_SECONDS = 5 * 60;

/** Event types we record. Opens and clicks only arrive once open/click tracking is enabled in Resend. */
export const TRACKED_EVENT_TYPES = new Set([
  "email.opened",
  "email.clicked",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.delivery_delayed",
  "email.failed",
]);

export function verifySvixSignature(args: {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  secret: string;
  nowMs?: number;
}): boolean {
  const { id, timestamp, signature, body, secret } = args;
  if (!id || !timestamp || !signature || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - ts) > SVIX_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    let given: Buffer;
    try {
      given = Buffer.from(value, "base64");
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

export type ResendEvent = {
  eventType: string;
  occurredAt: string;
  emailId: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  bounceType: string | null;
  bounceReason: string | null;
};

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null;
}

/** Null when the payload is not an object with a string type; never throws. */
export function parseResendEvent(raw: unknown): ResendEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const eventType = str(r.type, 60);
  if (!eventType) return null;
  const data = r.data && typeof r.data === "object" && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : {};

  const toRaw = data.to;
  const to = Array.isArray(toRaw) ? str(toRaw[0], 320) : str(toRaw, 320);

  const bounce = data.bounce && typeof data.bounce === "object" && !Array.isArray(data.bounce) ? (data.bounce as Record<string, unknown>) : {};
  const bounceType = [str(bounce.type, 40), str(bounce.subType, 40)].filter(Boolean).join(" / ") || null;

  const created = str(r.created_at, 40) ?? str(data.created_at, 40);
  const parsed = created ? new Date(created) : null;
  const occurredAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();

  return {
    eventType,
    occurredAt,
    emailId: str(data.email_id, 100),
    from: str(data.from, 320),
    to,
    subject: str(data.subject, 300),
    bounceType,
    bounceReason: str(bounce.message, 500),
  };
}
