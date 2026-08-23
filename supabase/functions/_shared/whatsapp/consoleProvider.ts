import type { WhatsAppProvider } from "./types.ts";
import { assertDevFallbackAllowed } from "../devFallbackGuard.ts";

// Local-dev fallback only. Throws unless ALLOW_CONSOLE_FALLBACK=true — see
// devFallbackGuard.ts for why this must not silently succeed in production.
export class ConsoleWhatsAppProvider implements WhatsAppProvider {
  async send(phone: string, message: string): Promise<void> {
    assertDevFallbackAllowed("WhatsApp");
    console.log(`[dev-whatsapp] would send to ${phone}: ${message}`);
  }
}
