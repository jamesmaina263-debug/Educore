import type { EmailProvider } from "./types.ts";

export class ConsoleEmailProvider implements EmailProvider {
  async send(to: string, subject: string, message: string): Promise<void> {
    console.log(`[dev-email] would send to ${to} (subject: "${subject}"): ${message}`);
  }
}
