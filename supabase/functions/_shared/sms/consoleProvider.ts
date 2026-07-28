import type { SmsProvider } from "./types.ts";

// Fallback only. Used automatically when AT_USERNAME/AT_API_KEY aren't
// set (e.g. before production credentials are provided), so the OTP
// flow keeps working structurally during development without ever
// silently pretending to send a real SMS.
export class ConsoleSmsProvider implements SmsProvider {
  async send(phone: string, message: string): Promise<void> {
    console.log(`[dev-sms] would send to ${phone}: ${message}`);
  }
}
