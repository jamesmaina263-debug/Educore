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

// Outreach emails carry a small logo in the signature. Hosted on our own site (never embedded), sized for retina
// (the file is 312x99, shown at 156x50), on a white pad so the dark wordmark stays readable in dark-mode mail apps.
// Many clients hide remote images from unknown senders, so it is decoration only: the sign-off above it is text
// and the plain-text part has no logo. Other audiences (owners, prospects) are unchanged.
export const OUTREACH_LOGO_URL = "https://www.educoreafrica.com/email/educore-logo-email.png";
const OUTREACH_LOGO_HTML =
  `<img src="${OUTREACH_LOGO_URL}" width="156" height="50" alt="EduCore Africa" ` +
  `style="display:block;border:0;outline:none;width:156px;height:auto;margin:0 0 14px">`;

// Per-school tracked links. Outreach drafts carry fixed links (built by outreachLink() in src/lib/outbound/prospects.ts):
// <site>/[signup|contact|brochure]?utm_source=outreach&utm_medium=email&utm_campaign=school_outreach&utm_content=<key>.
// At send time each one is swapped for <site>/api/outreach-link/<recipient id>/<key>, which records that this school
// clicked and redirects to the very same page with the very same UTM tags (src/app/api/outreach-link). Only those
// exact links on our own site are touched: any other text or URL in a body is left alone, and a body that does not
// match (a different site origin, an edited link) simply stays untracked and keeps working.
const TRACKED_LINK_PATHS: Record<string, string> = { home: "/", signup: "/signup", contact: "/contact", brochure: "/brochure" };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function trackOutreachLinks(body: string, recipientId: string, siteUrl: string): string {
  const site = siteUrl.replace(/\/$/, "");
  if (!site || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipientId)) return body;
  const re = new RegExp(
    `${escapeRegExp(site)}(/(?:signup|contact|brochure)?)\\?utm_source=outreach&utm_medium=email&utm_campaign=school_outreach&utm_content=(home|signup|contact|brochure)(?![\\w&=%])`,
    "g",
  );
  return body.replace(re, (whole, path: string, key: string) =>
    TRACKED_LINK_PATHS[key] === path ? `${site}/api/outreach-link/${recipientId}/${key}` : whole,
  );
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
  // can never inject markup; links are left as plain text on purpose (any tracking is done on the body before it gets here: trackOutreachLinks).
  const blocks = body.split(/\n{2,}/);
  // Logo goes straight after the sign-off ("Kind regards,"), above the opt-out line. If a reviewer edited the
  // sign-off away, it goes at the end instead so a signature-less email still ends with the brand.
  const signOffAt = blocks.findIndex((p) => /^kind regards\b/i.test(p.trim()));
  const logoAt = signOffAt >= 0 ? signOffAt : blocks.length - 1;
  const paragraphs = blocks
    .map((p, i) => {
      const para = `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`;
      return input.audience === "outreach" && i === logoAt ? para + OUTREACH_LOGO_HTML : para;
    })
    .join("");

  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1f2933;line-height:1.55">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:28px;border-radius:8px">${paragraphs}</div>` +
    `<p style="max-width:560px;margin:14px auto 0;font-size:12px;color:#6b7280">${escapeHtml(footerLine)} ` +
    `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a>.</p>` +
    `</body></html>`;

  return { text, html };
}
