import type { EmailProvider, EmailAttachment } from "./types.ts";

export class ResendProvider implements EmailProvider {
  constructor(
    private apiKey: string,
    private fromAddress: string,
  ) {}

  async send(to: string, subject: string, message: string, attachments?: EmailAttachment[]): Promise<void> {
    // Same reasoning as the WhatsApp/M-Pesa providers: send-communication processes a whole
    // batch sequentially, so one hung request here blocks every message behind it.
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: [to],
          subject,
          text: message,
          ...(attachments && attachments.length > 0
            ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.contentBase64 })) }
            : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        throw new Error("Resend email send timed out after 10s -- Resend's API may be slow or unreachable.");
      }
      throw e;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Resend email send failed (${res.status}): ${text}`);
    }
  }
}
