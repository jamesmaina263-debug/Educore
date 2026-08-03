import type { WhatsAppProvider } from "./types.ts";
import { TwilioWhatsAppProvider } from "./twilioProvider.ts";
import { ConsoleWhatsAppProvider } from "./consoleProvider.ts";

export function getWhatsAppProvider(): WhatsAppProvider {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_WHATSAPP_FROM");

  if (accountSid && authToken && fromNumber) {
    return new TwilioWhatsAppProvider(accountSid, authToken, fromNumber);
  }

  console.warn(
    "[whatsapp] TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM not configured — using ConsoleWhatsAppProvider (dev only, no real WhatsApp message sent)",
  );
  return new ConsoleWhatsAppProvider();
}
