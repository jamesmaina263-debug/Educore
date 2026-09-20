import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";
import { buildCsp, marketingHeaderSources } from "./src/lib/csp";

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
    // The directive-by-directive reasoning lives in src/lib/csp.ts. `csp` applies
    // everywhere; `marketingCsp` (same policy plus the hosts Google documents
    // for Google Ads and Ads-linked Google Analytics) is applied only to the
    // public marketing pages and /signup, the only places GTM loads.
    const csp = buildCsp({ supabaseOrigin });
    const marketingCsp = buildCsp({ supabaseOrigin, marketing: true });

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
      // Later rules override earlier ones for the same header key, so these
      // replace only the CSP on the marketing pages and /signup.
      ...marketingHeaderSources(path.join(process.cwd(), "src/app/(marketing)")).map((source) => ({
        source,
        headers: [{ key: "Content-Security-Policy", value: marketingCsp }],
      })),
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
