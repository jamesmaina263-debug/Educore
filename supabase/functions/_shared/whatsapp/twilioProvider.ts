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

    // send-communication processes up to 100 queued messages per invocation in a sequential
    // loop (see its own comment on why) -- a single hung Twilio request with no timeout would
    // block every message behind it in that batch, not just this one, and risks the whole
    // invocation running into the edge function's own wall-clock limit with nothing sent.
    let res: Response;
    try {
      res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        throw new Error("Twilio WhatsApp send timed out after 10s -- Twilio's API may be slow or unreachable.");
      }
      throw e;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twilio WhatsApp send failed (${res.status}): ${text}`);
    }
  }
}
