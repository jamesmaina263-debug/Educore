import type { ReactNode } from "react";
import { GoogleTagManager } from "@next/third-parties/google";

// /signup currently has no GTM coverage at all -- it isn't wrapped by
// (marketing)/layout.tsx (which loads GTM-MGV2XHBB), and the root layout
// deliberately excludes GTM (see its own comment: GTM was moved out of the
// root layout specifically because it wraps the authenticated (app) and
// (admin) route groups, where real student/health/financial PII renders).
// /signup is neither of those -- it's a public, pre-auth "start a school"
// page, the same category as /contact -- so loading GTM here doesn't
// reintroduce that risk. Same container ID as the marketing site, so a
// sign_up conversion attributes to the same GA4 property/campaigns as the
// rest of the funnel (see src/app/signup/signup-form.tsx for the event).
export default function SignupLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <GoogleTagManager gtmId="GTM-MGV2XHBB" />
      {children}
    </>
  );
}
