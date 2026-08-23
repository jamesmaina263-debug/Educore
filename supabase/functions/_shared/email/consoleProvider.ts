import type { EmailProvider, EmailAttachment } from "./types.ts";
import { assertDevFallbackAllowed } from "../devFallbackGuard.ts";

// Local-dev fallback only. Throws unless ALLOW_CONSOLE_FALLBACK=true — see
// devFallbackGuard.ts for why this must not silently succeed in production.
export class ConsoleEmailProvider implements EmailProvider {
  async send(to: string, subject: string, message: string, attachments?: EmailAttachment[]): Promise<void> {
    assertDevFallbackAllowed("Email");
    const attachmentNote = attachments && attachments.length > 0 ? ` [with attachment: ${attachments.map((a) => a.filename).join(", ")}]` : "";
    console.log(`[dev-email] would send to ${to} (subject: "${subject}"): ${message}${attachmentNote}`);
  }
}
