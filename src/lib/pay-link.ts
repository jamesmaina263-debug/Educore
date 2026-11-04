import { createHash } from "node:crypto";

// Pay by Link helpers (WP 1.3). Pure functions only, so they can be unit-tested.
// The token is 64 lowercase hex characters, shown to staff once; the database stores only its
// SHA-256 hex, computed the same way as below (and by create_pay_link() in SQL).

export const PAY_LINK_TOKEN_RE = /^[0-9a-f]{64}$/;

export function isPayLinkToken(value: string): boolean {
  return PAY_LINK_TOKEN_RE.test(value);
}

export function hashPayLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Normalises what a payer types to 2547XXXXXXXX / 2541XXXXXXXX, or null if it is not a Kenyan mobile number. */
export function normalizeKenyanMsisdn(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  let national: string;
  if (/^254\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{9}$/.test(digits)) national = digits;
  else return null;
  return /^[17]\d{8}$/.test(national) ? `254${national}` : null;
}

export const PAY_LINK_UNAVAILABLE_MESSAGE =
  "This payment link is not available. It may have expired or already been used. Please contact the school for a new link.";

/** Maps the database's exception text to a message that is safe to show a payer. */
export function payLinkErrorMessage(raw: string | null | undefined): string {
  const text = raw ?? "";
  if (text.includes("INVALID_PHONE")) return "Please enter a valid Safaricom number, for example 0712 345 678.";
  if (text.includes("RATE_LIMITED")) return "Too many attempts. Please wait a while and try again.";
  if (text.includes("PROMPT_IN_PROGRESS")) return "A prompt was just sent to your phone. Please approve it, or wait two minutes and try again.";
  if (text.includes("LINK_NOT_AVAILABLE")) return PAY_LINK_UNAVAILABLE_MESSAGE;
  return "We could not start the payment. Please try again in a moment.";
}

export function buildPayLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/pay/${token}`;
}
