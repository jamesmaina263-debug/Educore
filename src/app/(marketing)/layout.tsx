import type { ReactNode } from "react";
import { GoogleTagManager } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/next";
import { MarketingNav } from "@/components/marketing/nav";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingJsonLd } from "@/components/marketing/json-ld";
import { MarketingAnalytics } from "@/components/marketing/analytics";

// Shared by every public marketing page (see src/lib/school-slug-routing.ts
// NEVER_PREFIX for the full route list this covers). Deliberately does not
// call supabase.auth.getUser() or check any session -- unlike
// (app)/layout.tsx, this layout must never require authentication. Anyone,
// logged in or not, sees the same nav/footer here.
//
// GTM (GTM-MGV2XHBB) lives here rather than the root layout (src/app/
// layout.tsx) on purpose -- it must only ever reach public marketing pages,
// never the authenticated school app or platform admin console, both of
// which render real student/health/financial PII. See the root layout's
// comment for the incident this corrects. Feeds the GA4 property that
// src/lib/ga4.ts / src/app/(admin)/admin/analytics reads from -- that
// dashboard's own stated scope is marketing-site performance only, so this
// keeps GTM's actual reach matching that stated scope.
//
// Vercel's <Analytics /> component is scoped here for the same reason --
// same PII boundary as GTM, and it doubles as a second, independent traffic
// source (real edge request data, not GA4's client-side + Google's bot
// filtering) to sanity-check the country/region breakdown on the admin
// analytics page against. It is a no-op until Web Analytics is turned on
// for this project in the Vercel dashboard (Project -> Analytics -> Enable)
// -- no API for that step, it's a one-time manual toggle.
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-marketing-canvas">
      <GoogleTagManager gtmId="GTM-MGV2XHBB" />
      <MarketingJsonLd />
      <MarketingAnalytics />
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
      <Analytics />
    </div>
  );
}
