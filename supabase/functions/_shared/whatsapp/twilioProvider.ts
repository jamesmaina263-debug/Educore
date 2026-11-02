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
    await this.post(
      new URLSearchParams({
        From: `whatsapp:${this.fromNumber}`,
        To: `whatsapp:${phone}`,
        Body: message,
      }),
      10000,
    );
  }

  // A document message: Twilio downloads mediaUrl itself, so it must be reachable from the public
  // internet for a few minutes (the bot passes a 10-minute signed URL). Longer timeout than a
  // text because Twilio fetches the file before it accepts the message.
  async sendMedia(phone: string, caption: string, mediaUrl: string): Promise<void> {
    await this.post(
      new URLSearchParams({
        From: `whatsapp:${this.fromNumber}`,
        To: `whatsapp:${phone}`,
        Body: caption,
        MediaUrl: mediaUrl,
      }),
      15000,
    );
  }

  private async post(body: URLSearchParams, timeoutMs: number): Promise<void> {
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
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        throw new Error(`Twilio WhatsApp send timed out after ${timeoutMs / 1000}s -- Twilio's API may be slow or unreachable.`);
      }
      throw e;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twilio WhatsApp send failed (${res.status}): ${text}`);
    }
  }
}
