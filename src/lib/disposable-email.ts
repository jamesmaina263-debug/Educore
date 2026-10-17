// Blocks well-known disposable / throwaway inbox providers at signup.
//
// Why: the signup flow proves inbox ownership by emailing a set-password link (the account gets a
// random password nobody sees). That check is worthless for a public inbox such as Mailinator,
// where anyone can open the mail and click the link. Blocking these domains keeps free trials tied
// to an address the owner actually controls.
//
// Deliberately a small, conservative list of providers that are unambiguously disposable -- a
// false positive turns away a real school. Extend it as abusers show up; do not add free
// webmail (gmail.com, yahoo.com, outlook.com ...): many real Kenyan schools use those.

export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "mailinator.net",
  "mailinator.org",
  "mailinator2.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamailblock.com",
  "sharklasers.com",
  "grr.la",
  "10minutemail.com",
  "10minutemail.net",
  "temp-mail.org",
  "temp-mail.io",
  "tempmail.com",
  "tempmail.net",
  "tempail.com",
  "tempr.email",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "trashmail.org",
  "trashmail.de",
  "getnada.com",
  "nada.email",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "mailnesia.com",
  "mintemail.com",
  "mytemp.email",
  "spamgourmet.com",
  "discard.email",
  "moakt.com",
  "emailondeck.com",
  "burnermail.io",
  "mohmal.com",
  "mail.tm",
  "inboxkitten.com",
  "mailcatch.com",
  "jetable.org",
  "spambox.us",
]);

/** Lower-cased domain part of an email address, or null if it has no usable domain. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.+$/, "");
  return domain || null;
}

/** True when the address is on a known disposable provider (including any subdomain of one). */
export function isDisposableEmail(email: string): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  const parts = domain.split(".");
  // Check the full domain and every parent domain, so "x.mailinator.com" is caught too.
  for (let i = 0; i < parts.length - 1; i++) {
    if (DISPOSABLE_EMAIL_DOMAINS.has(parts.slice(i).join("."))) return true;
  }
  return false;
}
