export interface EmailAttachment {
  filename: string;
  contentBase64: string;
}

// Opt-in extras, used by promotional campaigns. Existing callers never pass this, so their
// plain-text behaviour is unchanged.
export interface EmailSendOptions {
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface EmailProvider {
  send(
    to: string,
    subject: string,
    message: string,
    attachments?: EmailAttachment[],
    from?: string,
    options?: EmailSendOptions,
  ): Promise<void>;
}
