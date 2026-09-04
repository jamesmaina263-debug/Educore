import type { EmailProvider } from "./types.ts";
import { ZohoProvider } from "./zohoProvider.ts";
import { ResendProvider } from "./resendProvider.ts";
import { ConsoleEmailProvider } from "./consoleProvider.ts";

// Same factory pattern as _shared/sms/index.ts — swapping email providers later
// means adding a new class here and changing this one function.
export function getEmailProvider(): EmailProvider {
  const zohoClientId = Deno.env.get("ZOHO_CLIENT_ID");
  const zohoClientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
  const zohoRefreshToken = Deno.env.get("ZOHO_REFRESH_TOKEN");
  const zohoAccountId = Deno.env.get("ZOHO_ACCOUNT_ID");
  const zohoFromAddress = Deno.env.get("ZOHO_FROM_ADDRESS");

  if (zohoClientId && zohoClientSecret && zohoRefreshToken && zohoAccountId && zohoFromAddress) {
    return new ZohoProvider(zohoClientId, zohoClientSecret, zohoRefreshToken, zohoAccountId, zohoFromAddress);
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const fromAddress = Deno.env.get("RESEND_FROM_ADDRESS");

  if (apiKey && fromAddress) {
    return new ResendProvider(apiKey, fromAddress);
  }

  console.warn(
    "[email] No email provider configured (checked Zoho, then Resend) — using ConsoleEmailProvider (dev only, no real email sent)",
  );
  return new ConsoleEmailProvider();
}
