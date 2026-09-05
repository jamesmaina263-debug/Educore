import type { EmailProvider } from "./types.ts";
import { ResendProvider } from "./resendProvider.ts";
import { ConsoleEmailProvider } from "./consoleProvider.ts";

// Resend is the sending provider for all school-facing email (send-communication,
// notify-platform-admin, request-otp). Deliberately NOT wired to Zoho here — Zoho is
// a separate, read-only company-mailbox monitoring integration surfaced in the Admin
// Console (see src/lib/zoho-mail-monitor.ts / /admin/company-email), not a swap-in
// replacement for this send path. Do not add Zoho back into this factory without
// explicit sign-off — an earlier attempt to do so risked silently rerouting real
// school communications through Zoho's free-tier send limits.
export function getEmailProvider(): EmailProvider {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const fromAddress = Deno.env.get("RESEND_FROM_ADDRESS");

  if (apiKey && fromAddress) {
    return new ResendProvider(apiKey, fromAddress);
  }

  console.warn(
    "[email] RESEND_API_KEY/RESEND_FROM_ADDRESS not configured — using ConsoleEmailProvider (dev only, no real email sent)",
  );
  return new ConsoleEmailProvider();
}
