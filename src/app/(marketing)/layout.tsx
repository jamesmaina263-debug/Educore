import type { ReactNode } from "react";
import { MarketingNav } from "@/components/marketing/nav";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingJsonLd } from "@/components/marketing/json-ld";
import { MarketingAnalytics } from "@/components/marketing/analytics";

// Shared by every public marketing page (see src/lib/school-slug-routing.ts
// NEVER_PREFIX for the full route list this covers). Deliberately does not
// call supabase.auth.getUser() or check any session -- unlike
// (app)/layout.tsx, this layout must never require authentication. Anyone,
// logged in or not, sees the same nav/footer here.
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-marketing-canvas">
      <MarketingJsonLd />
      <MarketingAnalytics />
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
