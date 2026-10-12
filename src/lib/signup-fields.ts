// Small field helpers for the self-serve school signup. No "use server"/"use client" directive so
// the server action, the form and tests can share them.

/** Strict E.164 shape accepted for school/owner phone numbers (matches the previous rule). */
export const E164_RE = /^\+[1-9]\d{7,14}$/;

/**
 * Turns the way people actually type a Kenyan number into E.164:
 *   0712 345 678 / 0112-345-678 -> +254712345678 / +254112345678
 *   254712345678               -> +254712345678
 *   +254 712 345 678           -> +254712345678
 * Other international numbers that already start with "+" are kept if they are valid E.164.
 * Returns null when it cannot be a phone number. Checks plausibility, not reachability.
 */
export function toE164(raw: unknown): string | null {
  const input = String(raw ?? "").trim();
  if (!input || input.length > 40 || !/^[+\d\s().-]+$/.test(input)) return null;
  const hasPlus = input.startsWith("+");
  const digits = input.replace(/\D/g, "");

  let candidate: string;
  if (hasPlus) candidate = `+${digits}`;
  else if (/^0[17]\d{8}$/.test(digits)) candidate = `+254${digits.slice(1)}`;
  else if (/^254[17]\d{8}$/.test(digits)) candidate = `+${digits}`;
  else return null;

  return E164_RE.test(candidate) ? candidate : null;
}

/** Strips control/zero-width characters and caps length for free-text signup fields. */
export function cleanSignupText(raw: unknown, max: number): string {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
