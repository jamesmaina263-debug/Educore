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

    // Sandbox and live are entirely separate hosts at Africa's Talking — a
    // sandbox API key is rejected with a 401 ("supplied authentication is
    // invalid") if sent to the live host, and vice versa. username=sandbox
    // is the one reliable signal we have for which environment we're in.
    const host = this.username === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
    const res = await fetch(`https://${host}/version1/messaging`, {
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
