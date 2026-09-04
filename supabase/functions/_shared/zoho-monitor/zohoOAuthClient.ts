const ZOHO_ACCOUNTS_BASE = "https://accounts.zoho.com";
const ZOHO_MAIL_BASE = "https://mail.zoho.com/api";

export type EmailAttachment = {
  filename: string;
  contentBase64: string;
};

type UploadedAttachment = {
  storeName: string;
  attachmentName: string;
  attachmentPath: string;
};

// Standalone OAuth client for the Zoho Mail REST API (self-client / refresh-token
// flow). This is intentionally NOT part of the school-communication send path
// (_shared/email/*, which uses Resend) -- it exists solely to back the Admin
// Console's read-only company-email monitoring feature (james.maina@educoreafrica.com
// and colleague mailboxes on the same domain). send() below is kept for potential
// future use (e.g. a digest/alert email FROM the monitoring feature itself), but
// nothing in the school-facing send flow should ever construct or call this class.
// See ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN / ZOHO_ACCOUNT_ID /
// ZOHO_FROM_ADDRESS in Supabase secrets for the credentials this needs.
export class ZohoMailClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0; // epoch ms

  constructor(
    private clientId: string,
    private clientSecret: string,
    private refreshToken: string,
    private accountId: string,
    private fromAddress: string,
  ) {}

  // Reuses a still-valid token across multiple sends within the same
  // function invocation (one Provider instance per invocation) rather than
  // refreshing before every message — Zoho's token endpoint has its own
  // rate limit, and send-communication can dispatch many messages in a loop.
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    const params = new URLSearchParams({
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
    });

    const res = await fetch(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/token?${params}`, {
      method: "POST",
    });
    const body = await res.json();

    if (!res.ok || !body.access_token) {
      throw new Error(`Zoho OAuth token refresh failed (${res.status}): ${JSON.stringify(body)}`);
    }

    this.accessToken = body.access_token as string;
    // expires_in is seconds; refresh a minute early to avoid a token dying
    // mid-batch.
    this.accessTokenExpiresAt = Date.now() + (Number(body.expires_in ?? 3600) - 60) * 1000;
    return this.accessToken;
  }

  // Zoho requires attachments to be uploaded separately first, then
  // referenced by storeName/attachmentPath in the send call — unlike
  // Resend's inline base64 attachments.
  private async uploadAttachment(token: string, attachment: EmailAttachment): Promise<UploadedAttachment> {
    const bytes = Uint8Array.from(atob(attachment.contentBase64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("attach", new Blob([bytes]), attachment.filename);

    const res = await fetch(
      `${ZOHO_MAIL_BASE}/accounts/${this.accountId}/messages/attachments?uploadType=multipart`,
      {
        method: "POST",
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        body: form,
      },
    );
    const body = await res.json();

    if (!res.ok || body?.status?.code !== 200) {
      // Zoho self-client apps sometimes hit UPLOAD_RULE_NOT_CONFIGURED on
      // attachment upload even with correct scopes — a known Zoho-side
      // quirk, not a bug in this code. If you hit it, double-check the
      // ZohoMail.messages.ALL scope was granted, or raise it with Zoho
      // support.
      throw new Error(
        `Zoho attachment upload failed for "${attachment.filename}" (${res.status}): ${JSON.stringify(body)}`,
      );
    }

    const info = Array.isArray(body.data) ? body.data[0] : body.data;
    return {
      storeName: info.storeName,
      attachmentName: info.attachmentName,
      attachmentPath: info.attachmentPath,
    };
  }

  async send(to: string, subject: string, message: string, attachments?: EmailAttachment[]): Promise<void> {
    const token = await this.getAccessToken();

    let uploaded: UploadedAttachment[] = [];
    if (attachments && attachments.length > 0) {
      uploaded = await Promise.all(attachments.map((a) => this.uploadAttachment(token, a)));
    }

    const res = await fetch(`${ZOHO_MAIL_BASE}/accounts/${this.accountId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fromAddress: this.fromAddress,
        toAddress: to,
        subject,
        content: message,
        mailFormat: "plaintext",
        ...(uploaded.length > 0 ? { attachments: uploaded } : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zoho email send failed (${res.status}): ${text}`);
    }
  }
}
