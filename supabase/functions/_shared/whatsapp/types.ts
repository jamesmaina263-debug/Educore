export interface WhatsAppProvider {
  send(phone: string, message: string): Promise<void>;
  // Sends a file (PDF) with a caption. mediaUrl must be publicly fetchable by the provider for a
  // short time (a signed URL), because the provider downloads it from there.
  sendMedia(phone: string, caption: string, mediaUrl: string): Promise<void>;
}
