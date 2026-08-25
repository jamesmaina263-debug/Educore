// Port of supabase/functions/_shared/devFallbackGuard.ts -- see that file's
// header comment for the full story: a Console*Provider that didn't throw
// once caused every SMS in production to render "sent" in the UI while
// nothing actually left the server, because missing credentials silently
// fell back to logging instead of failing loudly. Fixed there by requiring
// an explicit opt-in to simulate a send; ported here unchanged so the
// ZKTeco path can't reintroduce the same failure mode.
export function assertDevFallbackAllowed(channel: string): void {
  if (process.env.ALLOW_CONSOLE_FALLBACK === "true") return;

  throw new Error(
    `${channel} is not configured (missing provider credentials) and ALLOW_CONSOLE_FALLBACK is not set to "true". ` +
      `Refusing to silently pretend this message was sent. Configure real provider credentials, or set ` +
      `ALLOW_CONSOLE_FALLBACK=true in local/preview environments only.`,
  );
}
