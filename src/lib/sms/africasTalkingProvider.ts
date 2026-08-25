import type { SmsProvider } from "./types";

// Line-for-line port of supabase/functions/_shared/sms/africasTalkingProvider.ts.
// Africa's Talking's HTTP API is plain fetch + form-encoding, so nothing
// here is Deno-specific -- the only difference from the Edge Function
// version is where the credentials come from (process.env, not Deno.env;
// see src/lib/sms/index.ts).
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

    // Sandbox and live are entirely separate hosts at Africa's Talking -- a
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
    const recipients: Array<{ status: string; number: string }> = data?.SMSMessageData?.Recipients ?? [];
    const failed = recipients.filter((r) => r.status !== "Success");

    if (failed.length > 0) {
      throw new Error(`Africa's Talking rejected recipient(s): ${JSON.stringify(failed)}`);
    }
  }
}
