import { createHash } from "node:crypto";

const PWNED_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Checks a candidate password against Have I Been Pwned's Pwned Passwords
 * database, using the k-anonymity range API so the real password (or even
 * its full hash) never leaves this server: we hash it ourselves and send
 * only the first 5 hex characters of the SHA-1 digest, then compare the
 * remaining suffix locally against the list HIBP returns for that prefix.
 * See https://haveibeenpwned.com/API/v3#PwnedPasswords.
 *
 * This exists because Supabase Auth's own equivalent (leaked-password
 * protection under Authentication > Policies) is gated behind a paid plan
 * on this project — this is the free-tier equivalent, implemented in our
 * own signup/password-change code instead of toggled in the dashboard.
 *
 * Deliberately fails OPEN (returns false / "not pwned") on any network
 * error, timeout, or non-2xx response from HIBP. This is the opposite
 * tradeoff from verifyTurnstileToken (which fails closed) because a third
 * -party outage blocking someone from resetting a forgotten password is a
 * worse outcome for a school platform than occasionally missing a breach
 * check — this is a defense-in-depth quality gate, not the primary
 * authentication boundary.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  if (!password) return false;

  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const res = await fetch(`${PWNED_RANGE_URL}${prefix}`, {
      // Recommended by HIBP: pads the response with decoy entries so a
      // network observer can't infer a hit/miss from response size alone.
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return false;

    const body = await res.text();
    return body.split("\n").some((line) => line.split(":")[0].trim() === suffix);
  } catch {
    return false;
  }
}
