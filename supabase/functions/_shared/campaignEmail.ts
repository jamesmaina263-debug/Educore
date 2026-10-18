// Pure rendering for promotional owner emails -- no Deno or network access, so it is unit-tested
// from vitest (src/lib/campaign-email.test.ts) as well as imported by send-owner-campaign.

export interface CampaignEmailInput {
  body: string;
  recipientName?: string | null;
  // Prospects often have no school name on file; {{school}} then reads "your school".
  schoolName?: string | null;
  unsubscribeUrl: string;
  // Controls the footer wording only. Defaults to school owners (the original behaviour).
  audience?: "owners" | "prospects" | "outreach";
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function firstName(fullName?: string | null): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return first;
}

// {{name}} -> first name (falls back to "there"), {{school}} -> the school's name (falls back to
// "your school").
export function personalize(template: string, input: Pick<CampaignEmailInput, "recipientName" | "schoolName">): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, firstName(input.recipientName) || "there")
    .replace(/\{\{\s*school\s*\}\}/gi, () => (input.schoolName ?? "").trim() || "your school");
}

export function renderCampaignEmail(input: CampaignEmailInput): { text: string; html: string } {
  const body = personalize(input.body, input).trim();
  const footerLine =
    input.audience === "outreach"
      ? `We're writing to ${(input.schoolName ?? "").trim() || "your school"} because its contact details are publicly listed and EduCore may be useful to you. If this isn't relevant, unsubscribe below and we won't email again.`
      : input.audience === "prospects"
        ? "You're receiving this because you asked about EduCore on our website."
        : `You're receiving this because you're the owner of ${(input.schoolName ?? "").trim() || "your school"} on EduCore.`;

  const text = `${body}\n\n--\n${footerLine}\nUnsubscribe: ${input.unsubscribeUrl}\nEduCore - https://educoreafrica.com`;

  // Blank line = new paragraph, single newline = <br>. Everything is escaped first, so a body
  // can never inject markup; links are left as plain text on purpose (no tracking, no rewriting).
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1f2933;line-height:1.55">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:28px;border-radius:8px">${paragraphs}</div>` +
    `<p style="max-width:560px;margin:14px auto 0;font-size:12px;color:#6b7280">${escapeHtml(footerLine)} ` +
    `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a>.</p>` +
    `</body></html>`;

  return { text, html };
}
