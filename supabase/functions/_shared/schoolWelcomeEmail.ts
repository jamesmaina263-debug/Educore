// Pure rendering for the one-time "welcome to EduCore Africa" email sent to a newly registered school.
// No Deno or network access, so it is unit-tested from vitest (src/lib/school-welcome-email.test.ts) as well
// as imported by the send-school-welcome Edge Function.

export const WELCOME_EMAIL_SUBJECT = "Welcome to EduCore Africa – We're Here to Support Your School!";
export const WHATSAPP_SUPPORT_URL = "https://wa.me/254702904562";
export const EDUCORE_SITE_URL = "https://educoreafrica.com";
// Same hosted logo the outreach emails use (see campaignEmail.ts). Decoration only: many mail apps hide remote
// images, so the email reads completely without it.
export const WELCOME_LOGO_URL = "https://www.educoreafrica.com/email/educore-logo-email.png";

// The school name is typed by the visitor at signup, so it is untrusted: it is escaped before it goes into HTML
// and stripped of line breaks before it is used anywhere a newline would matter.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanName(schoolName?: string | null): string {
  return (schoolName ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 200);
}

export interface SchoolWelcomeEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderSchoolWelcomeEmail(input: { schoolName?: string | null }): SchoolWelcomeEmail {
  const name = cleanName(input.schoolName);
  // "Dear {{school_name}} Team," -- falls back to a plain greeting if no name is on file.
  const greeting = name ? `Dear ${name} Team,` : "Hello,";

  const paragraphs = [
    "Welcome to EduCore Africa!",
    "Thank you for choosing EduCore Africa to support your school's day-to-day operations. We're delighted to have you on board and look forward to helping your team manage school activities more efficiently.",
    "Our platform brings essential school management functions together in one place, helping you simplify administration and focus more on your learners.",
    "As you get started, please remember that our team is here to help. If you encounter any challenges, have questions, or need assistance setting up your school, reach us directly on WhatsApp using the link below:",
  ];
  const closing = [
    "We're committed to making your experience with EduCore Africa as smooth and productive as possible.",
    "Thank you for trusting EduCore Africa. We look forward to growing with your school!",
  ];

  const text = [
    greeting,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    `WhatsApp Support: ${WHATSAPP_SUPPORT_URL}`,
    "",
    ...closing.flatMap((p) => [p, ""]),
    "Warm regards,",
    "The EduCore Africa Team",
    EDUCORE_SITE_URL,
  ].join("\n");

  const p = (s: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f2933">${esc(s)}</p>`;

  // Table layout + inline styles + a fluid 600px container: renders the same in Gmail, Outlook and phone mail apps.
  // The WhatsApp button is a padded link (large tap target) and the URL is also printed in full underneath it.
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>${esc(WELCOME_EMAIL_SUBJECT)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f7f9"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px">` +
    `<tr><td style="padding:28px 28px 8px">` +
    `<img src="${WELCOME_LOGO_URL}" width="156" height="50" alt="EduCore Africa" style="display:block;border:0;outline:none;width:156px;height:auto;margin:0 0 20px">` +
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f2933">${esc(greeting)}</p>` +
    paragraphs.map(p).join("") +
    `</td></tr>` +
    `<tr><td align="center" style="padding:4px 28px 8px">` +
    `<a href="${WHATSAPP_SUPPORT_URL}" style="display:inline-block;background:#25d366;color:#073b1d;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:6px">Chat with us on WhatsApp</a>` +
    `<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#52606d">WhatsApp Support: ` +
    `<a href="${WHATSAPP_SUPPORT_URL}" style="color:#1a56db;text-decoration:underline;word-break:break-all">${WHATSAPP_SUPPORT_URL}</a></p>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 28px 28px">` +
    closing.map(p).join("") +
    `<p style="margin:0;font-size:16px;line-height:1.6;color:#1f2933">Warm regards,<br>The EduCore Africa Team<br>` +
    `<a href="${EDUCORE_SITE_URL}" style="color:#1a56db;text-decoration:underline">${EDUCORE_SITE_URL}</a></p>` +
    `</td></tr></table></td></tr></table></body></html>`;

  return { subject: WELCOME_EMAIL_SUBJECT, text, html };
}
