const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verifies a Cloudflare Turnstile token server-side. Never trust the
 * client-side widget alone — a scripted request can just omit it or send a
 * stale token, so every form that renders the widget must call this from
 * its server action before doing anything account-creating.
 *
 * TURNSTILE_SECRET_KEY is server-only (never exposed to the browser). If
 * it isn't configured, this fails closed (returns false) rather than
 * silently skipping verification.
 */
export async function verifyTurnstileToken(token: string, remoteIp?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Network failure talking to Cloudflare — fail closed, same as a
    // missing/invalid token. Better a false-negative signup retry than
    // letting an unverified submission through.
    return false;
  }
}
