import type { EmailProvider } from "./types.ts";
import { ResendProvider } from "./resendProvider.ts";
import { ConsoleEmailProvider } from "./consoleProvider.ts";

// Same factory pattern as _shared/sms/index.ts — swapping email providers later
// means adding a new class here and changing this one function.
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
