import type { SmsProvider } from "./types";
import { assertDevFallbackAllowed } from "./devFallbackGuard";

// Local-dev fallback only. Throws unless ALLOW_CONSOLE_FALLBACK=true -- see
// devFallbackGuard.ts for why this must not silently succeed in production.
export class ConsoleSmsProvider implements SmsProvider {
  async send(phone: string, message: string): Promise<void> {
    assertDevFallbackAllowed("SMS");
    console.log(`[dev-sms] would send to ${phone}: ${message}`);
  }
}
