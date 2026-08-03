export interface EmailProvider {
  send(to: string, subject: string, message: string): Promise<void>;
}
