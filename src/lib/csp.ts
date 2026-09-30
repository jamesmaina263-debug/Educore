// Content-Security-Policy builder, used by next.config.ts.
//
// Two variants of the same policy:
//
//   base       -- applied to every route. Unchanged from the policy that has
//                 been enforcing in production: it allows Google Tag Manager
//                 and GA4 endpoints but nothing else Google.
//   marketing  -- applied ONLY to the public marketing pages and /signup, via
//                 later header rules in next.config.ts (Next.js: when two
//                 header rules match a path and set the same key, the last one
//                 wins). Adds the extra hosts Google documents as required for
//                 a Google Ads conversion / remarketing tag and for a Google
//                 Analytics property that is linked to Google Ads.
//
// Why not just widen the base policy: it also covers the authenticated school
// app and the admin console, which render real student, health and financial
// data. Allowing connections to *.google.com from those pages would give any
// script-injection bug there a place to send data. GTM only ever loads on the
// marketing pages and /signup (see src/app/layout.tsx for the incident that
// established that boundary), so only those pages get the wider policy.
//
// Source of the Google host lists (last updated 2026-09-18):
//   https://developers.google.com/tag-platform/security/guides/csp
// "Google Analytics" (with Ads features) and "Google Ads" sections. Google
// requires each country TLD to be listed separately; the only ad-targeting
// country here is Kenya, so .co.ke is included. Anything else a visitor's
// browser needs will show up as a violation report at /api/csp-report.
import { readdirSync } from "node:fs";

const GOOGLE_ADS = {
  scriptSrc: ["https://www.googleadservices.com", "https://www.google.com"],
  connectSrc: [
    "https://*.google.com",
    "https://*.google.co.ke",
    "https://*.g.doubleclick.net",
    "https://pagead2.googlesyndication.com",
    "https://www.googleadservices.com",
    "https://ad.doubleclick.net",
  ],
  frameSrc: ["https://www.googletagmanager.com"],
} as const;

export function buildCsp({
  supabaseOrigin,
  marketing = false,
}: {
  supabaseOrigin: string;
  marketing?: boolean;
}): string {
  const ads = marketing ? GOOGLE_ADS : { scriptSrc: [], connectSrc: [], frameSrc: [] };
  const join = (...parts: readonly string[]) => parts.join(" ");

  return [
    "default-src 'self'",
    // Next.js injects small inline bootstrap/hydration scripts; 'unsafe-inline'
    // is required for those specifically (not a general allowance for
    // third-party script injection).
    // https://*.googletagmanager.com is GTM's own loader script plus any tag
    // GTM injects into the page afterward -- container-configured tags (GA4
    // included) load from the same host. This is a host-based allowlist, not a
    // nonce: a real nonce would require reading a per-request value via
    // next/headers in the root layout, which forces every page under it out of
    // static prerendering (verified against a build -- all marketing pages
    // would flip from prerendered to server-rendered per request). Deliberately
    // traded a marginally weaker script-src for keeping those pages static.
    // https://challenges.cloudflare.com is Turnstile's own loader script
    // (src/components/turnstile-widget.tsx, used on the signup-page captcha).
    join(
      "script-src 'self' 'unsafe-inline' https://*.googletagmanager.com https://challenges.cloudflare.com",
      ...ads.scriptSrc,
    ),
    // Tailwind v4 and Radix UI apply styles at runtime via inserted <style>
    // tags/inline style attributes -- 'unsafe-inline' is required here too.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Turnstile renders its widget in an iframe from its own host, and
    // src/components/document-preview-dialog.tsx renders PDF documents in an
    // iframe pointed at a short-lived signed Supabase Storage URL.
    join(
      `frame-src 'self' ${supabaseOrigin} https://challenges.cloudflare.com`,
      ...ads.frameSrc,
    ),
    // google-analytics.com/analytics.google.com are GA4's own hit-collection
    // endpoints -- a separate fetch/beacon call GA4 makes after GTM loads it,
    // not a <script> element that script-src already covers.
    join(
      `connect-src 'self' ${supabaseOrigin} https://*.ingest.de.sentry.io https://*.ingest.sentry.io https://*.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com`,
      ...ads.connectSrc,
    ),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // report-uri is deprecated but still the only directive older/some mobile
    // browsers honor; report-to is the modern replacement and needs a matching
    // Report-To response header naming the same group. Sent together so
    // violations are visible regardless of which one a browser supports --
    // see /api/csp-report for what receives them.
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join("; ");
}

/**
 * Next.js header `source` patterns for every public page that loads GTM: the
 * homepage, every top-level route folder under src/app/(marketing), and
 * /signup. Read from the file system at build time so a new marketing page is
 * covered automatically -- otherwise its ad tags would be blocked silently.
 * Returns [] (i.e. those pages keep the base policy) if the folder cannot be
 * read, so a failure here can only under-allow, never over-allow.
 */
export function marketingHeaderSources(marketingDir: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(marketingDir, { withFileTypes: true })
      // Route groups "(x)", dynamic "[x]", private "_x" and parallel "@x"
      // folders are not literal top-level URL segments.
      .filter((entry) => entry.isDirectory() && !/^[([_@]/.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return ["/", ...[...names, "signup"].sort().map((name) => `/${name}/:path*`)];
}
