// Every channel provider factory (sms, email, whatsapp — see their respective
// index.ts) falls back to a Console*Provider when real credentials aren't
// configured. That fallback exists for local development, where logging
// "would send to X" to stdout is genuinely fine.
//
// The bug this guards against: none of the Console*Provider.send() methods
// used to throw, so send-communication's dispatch loop (which wraps each
// send in try/catch and marks the row "sent" on success, "failed" on a
// thrown error) had no way to tell "delivered via a real provider" apart
// from "silently discarded, logged to a function's stdout no one is
// watching." Deployed with missing production secrets, every message
// rendered with a green "sent" badge in the Communication history UI —
// indistinguishable from a real delivery — while nothing left the server.
//
// Fix: the console fallback now requires an explicit opt-in
// (ALLOW_CONSOLE_FALLBACK=true) to actually simulate a send. Set that only
// in local/preview environments. Anywhere it's unset — including a
// production project simply missing a provider's real credentials — every
// Console*Provider throws instead, so the row is correctly marked "failed"
// with a clear reason, and the UI reflects reality.
export function assertDevFallbackAllowed(channel: string): void {
  if (Deno.env.get("ALLOW_CONSOLE_FALLBACK") === "true") return;

  throw new Error(
    `${channel} is not configured (missing provider credentials) and ALLOW_CONSOLE_FALLBACK is not set to "true". ` +
      `Refusing to silently pretend this message was sent. Configure real provider credentials, or set ` +
      `ALLOW_CONSOLE_FALLBACK=true in local/preview environments only.`,
  );
}
