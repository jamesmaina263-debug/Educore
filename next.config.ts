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
