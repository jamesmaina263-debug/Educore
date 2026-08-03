import type { WhatsAppProvider } from "./types.ts";

// Twilio's WhatsApp Business API. `fromNumber` must be a Twilio-approved WhatsApp
// sender (sandbox number during dev, an onboarded business number in production) —
// this is a Twilio/Meta account-setup step outside what code can configure.
export class TwilioWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private accountSid: string,
    private authToken: string,
    private fromNumber: string,
  ) {}

  async send(phone: string, message: string): Promise<void> {
    const body = new URLSearchParams({
      From: `whatsapp:${this.fromNumber}`,
      To: `whatsapp:${phone}`,
      Body: message,
    });

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twilio WhatsApp send failed (${res.status}): ${text}`);
    }
  }
}
