export interface WhatsAppProvider {
  send(phone: string, message: string): Promise<void>;
}
