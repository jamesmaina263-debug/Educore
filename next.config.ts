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
    // Best-effort CSP built from reading the code (Sentry's DSN/ingest host in
    // instrumentation-client.ts, Supabase's URL pattern, Next/Tailwind's own
    // requirements) rather than from a live browser pass -- this environment
    // has no way to actually load the deployed app and watch what a real CSP
    // blocks, which is exactly the risk the previous version of this comment
    // called out. Shipping it directly in enforcing mode without that
    // verification could silently break pages in production (a blocked
    // Sentry beacon is harmless; a blocked Supabase fetch is not).
    //
    // So: Content-Security-Policy-Report-Only, not Content-Security-Policy.
    // Report-only mode sends the exact same violation reports (visible in
    // each browser's devtools Console/Network, and to report-uri if one is
    // wired up later) without blocking anything -- it's a real dry run
    // against production traffic. Once a deploy has run with this for a few
    // days with no unexpected violations, switch the header key below from
    // "Content-Security-Policy-Report-Only" to "Content-Security-Policy" to
    // start enforcing it.
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
      "script-src 'self' 'unsafe-inline' https://plausible.io",
      // Tailwind v4 and Radix UI apply styles at runtime via inserted <style>
      // tags/inline style attributes -- 'unsafe-inline' is required here too.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // plausible.io here too: the same script reports pageview/conversion
      // events back via fetch/beacon calls to its own origin, not Sentry's
      // or Supabase's.
      `connect-src 'self' ${supabaseOrigin} https://*.ingest.de.sentry.io https://*.ingest.sentry.io https://plausible.io`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

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
          { key: "Content-Security-Policy-Report-Only", value: csp },
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
