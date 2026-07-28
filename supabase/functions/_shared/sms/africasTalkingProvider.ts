import type { SmsProvider } from "./types.ts";

export class AfricasTalkingProvider implements SmsProvider {
  constructor(
    private username: string,
    private apiKey: string,
    private senderId?: string,
  ) {}

  async send(phone: string, message: string): Promise<void> {
    const body = new URLSearchParams({
      username: this.username,
      to: phone,
      message,
      ...(this.senderId ? { from: this.senderId } : {}),
    });

    const res = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: {
        apiKey: this.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Africa's Talking SMS send failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    const recipients: Array<{ status: string; number: string }> =
      data?.SMSMessageData?.Recipients ?? [];
    const failed = recipients.filter((r) => r.status !== "Success");

    if (failed.length > 0) {
      throw new Error(`Africa's Talking rejected recipient(s): ${JSON.stringify(failed)}`);
    }
  }
}
