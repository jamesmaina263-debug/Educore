import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// This path is already excluded from proxy.ts's matcher (per the
// MARKETING_SITE_STATUS.md Phase 9 note), so it needs no NEVER_PREFIX
// entry -- Next serves it directly.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Everything under (app)/ is behind auth and gets redirected to
        // /login for anonymous crawlers anyway, but disallowing the
        // known entry points explicitly keeps crawlers from wasting
        // budget on redirect chains and keeps authenticated-only URLs
        // out of search results. /signup is deliberately not disallowed
        // -- it's a real public "start a school" page, not an
        // authenticated route (see footer.tsx's "Account" links).
        disallow: ["/dashboard", "/login", "/parent-login"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
