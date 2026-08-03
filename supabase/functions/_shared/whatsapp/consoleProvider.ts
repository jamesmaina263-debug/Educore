import type { WhatsAppProvider } from "./types.ts";

export class ConsoleWhatsAppProvider implements WhatsAppProvider {
  async send(phone: string, message: string): Promise<void> {
    console.log(`[dev-whatsapp] would send to ${phone}: ${message}`);
  }
}
