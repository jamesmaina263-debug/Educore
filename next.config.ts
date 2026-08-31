import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB, which real admission-document uploads (scanned birth
      // certificates, photos) routinely exceed — was causing a hard 413 on
      // the public /apply/[slug] form. Raised to accommodate genuine document
      // attachments while still bounding request size.
      bodySizeLimit: "10mb",
    },
  },
  // Baseline hardening headers.
  async headers() {
    // CSP, now enforcing. This was Report-Only for a while because this
    // environment has no live browser to verify against -- but a thorough
    // static audit of every external resource this app actually loads (every
    // <script>, <iframe>, fetch/connect call, grepped across src/) found two
    // concrete gaps that the *original* Report-Only policy below would have
    // silently broken in enforcing mode, neither caught before because
    // nothing had actually exercised them against it:
    //   1. Cloudflare Turnstile (the signup-page captcha, src/components/
    //      turnstile-widget.tsx) loads its own script from
    //      challenges.cloudflare.com and renders its widget in an iframe from
    //      the same host -- script-src didn't allow the former and there was
    //      no frame-src at all (falls back to default-src 'self') for the
    //      latter. Enforcing the old policy as-is would have silently broken
    //      new-school signup.
    //   2. Document preview (src/components/document-preview-dialog.tsx,
    //      used across Admissions/Students/Staff document review) renders
    //      PDFs in an iframe pointed at a signed Supabase Storage URL -- same
    //      missing-frame-src problem, would have broken every PDF preview in
    //      the app app-wide.
    // Both are fixed below (script-src gains challenges.cloudflare.com; a new
    // frame-src covers 'self' + Supabase + Turnstile). A `report-to`/
    // `report-uri` pair now also points at /api/csp-report, so if this audit
    // still missed something, a real violation shows up in Vercel's runtime
    // logs (and Sentry) immediately instead of just quietly breaking a page
    // for whoever hit it -- enforcing mode still sends reports for anything
    // it blocks, same as report-only did.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    let supabaseOrigin = "https://*.supabase.co";
    try {
      if (supabaseUrl) supabaseOrigin = new URL(supabaseUrl).origin;
    } catch {
      // Malformed/missing env var -- fall back to the wildcard above rather
      // than producing an origin-less connect-src that would block every
      // Supabase call in report-only mode too.
    }
    const csp = [
      "default-src 'self'",
      // Next.js injects small inline bootstrap/hydration scripts; 'unsafe-inline'
      // is required for those specifically (not a general allowance for
      // third-party script injection). https://plausible.io is listed here
      // because src/components/marketing/analytics.tsx already loads its
      // script from there -- currently a no-op until NEXT_PUBLIC_PLAUSIBLE_DOMAIN
      // is set (see that file), but the CSP needs to allow it now so flipping
      // that env var later doesn't also require a CSP change to un-break it.
      // https://*.googletagmanager.com is GTM's own loader script
      // (src/app/layout.tsx's <GoogleTagManager>) plus any tag GTM injects
      // into the page afterward -- container-configured tags (GA4 included)
      // load from the same host. This is a host-based allowlist, not a
      // nonce: a real nonce would require reading a per-request value via
      // next/headers in the root layout, which forces every page under it
      // out of static prerendering (verified against a build -- all 11
      // marketing pages would flip from prerendered to server-rendered per
      // request). Deliberately traded a marginally weaker script-src for
      // keeping those pages static.
      // https://challenges.cloudflare.com is Turnstile's own loader script
      // (src/components/turnstile-widget.tsx, used on the signup-page
      // captcha) -- missing here would silently break new-school signup the
      // moment this policy started enforcing.
      "script-src 'self' 'unsafe-inline' https://plausible.io https://*.googletagmanager.com https://challenges.cloudflare.com",
      // Tailwind v4 and Radix UI apply styles at runtime via inserted <style>
      // tags/inline style attributes -- 'unsafe-inline' is required here too.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Two real consumers, both would break under the default (default-src
      // 'self') without this: Turnstile renders its widget in an iframe from
      // its own host, and src/components/document-preview-dialog.tsx renders
      // PDF documents (admission/student/staff uploads) in an iframe pointed
      // at a short-lived signed Supabase Storage URL.
      `frame-src 'self' ${supabaseOrigin} https://challenges.cloudflare.com`,
      // plausible.io here too: the same script reports pageview/conversion
      // events back via fetch/beacon calls to its own origin, not Sentry's
      // or Supabase's. google-analytics.com/analytics.google.com are GA4's
      // own hit-collection endpoints -- these need a connect-src entry
      // regardless of the script-src approach above, since that's a
      // separate fetch/beacon call GA4 makes after GTM loads it, not a
      // <script> element CSP already covers.
      `connect-src 'self' ${supabaseOrigin} https://*.ingest.de.sentry.io https://*.ingest.sentry.io https://plausible.io https://*.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      // report-uri is deprecated but still the only directive older/some
      // mobile browsers honor; report-to is the modern replacement and needs
      // a matching Report-To response header (below) naming the same group.
      // Sent together so violations are visible regardless of which one a
      // given browser supports -- see /api/csp-report for what receives them.
      "report-uri /api/csp-report",
      "report-to csp-endpoint",
    ].join("; ");

    const reportTo = JSON.stringify({
      group: "csp-endpoint",
      max_age: 10886400,
      endpoints: [{ url: "/api/csp-report" }],
    });

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Vercel serves everything over HTTPS already; this additionally
          // tells browsers to never even attempt plain HTTP on repeat visits.
          // 2 years + preload is the standard baseline for a domain that has
          // no legitimate HTTP use case (this app has none).
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Disables browser features this app never uses. Deliberately
          // conservative (deny-all) rather than allow-listing self for
          // features already unused, since enabling something later is a
          // one-line change and the safer default is off.
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          { key: "Report-To", value: reportTo },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // No SENTRY_AUTH_TOKEN is configured in this environment, so source-map upload is skipped
  // (the plugin no-ops with a warning rather than failing the build) — stack traces in Sentry
  // will show minified code until that token exists. Flagged, not silently worked around: add
  // SENTRY_AUTH_TOKEN + org/project here later to enable it. This also builds under Turbopack
  // (this project's build tool), which the Sentry plugin's build-time instrumentation doesn't
  // apply to anyway — runtime instrumentation (instrumentation.ts, instrumentation-client.ts)
  // is what's actually doing the error capture here, not this webpack plugin.
  silent: true,
});
