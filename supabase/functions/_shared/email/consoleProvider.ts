import type { EmailProvider } from "./types.ts";
import { assertDevFallbackAllowed } from "../devFallbackGuard.ts";

// Local-dev fallback only. Throws unless ALLOW_CONSOLE_FALLBACK=true — see
// devFallbackGuard.ts for why this must not silently succeed in production.
export class ConsoleEmailProvider implements EmailProvider {
  async send(to: string, subject: string, message: string): Promise<void> {
    assertDevFallbackAllowed("Email");
    console.log(`[dev-email] would send to ${to} (subject: "${subject}"): ${message}`);
  }
}
