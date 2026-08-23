export interface EmailAttachment {
  filename: string;
  contentBase64: string;
}

export interface EmailProvider {
  send(to: string, subject: string, message: string, attachments?: EmailAttachment[]): Promise<void>;
}
