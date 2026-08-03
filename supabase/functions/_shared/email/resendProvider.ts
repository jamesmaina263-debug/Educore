import type { EmailProvider } from "./types.ts";

export class ResendProvider implements EmailProvider {
  constructor(
    private apiKey: string,
    private fromAddress: string,
  ) {}

  async send(to: string, subject: string, message: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
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
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Resend email send failed (${res.status}): ${text}`);
    }
  }
}
