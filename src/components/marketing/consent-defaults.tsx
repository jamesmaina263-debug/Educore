import { consentDefaultsScript } from "@/lib/marketing/consent";

// Renders the tiny inline script that applies a returning visitor's "declined"
// cookie choice to Google Consent Mode BEFORE GTM loads. Must be placed
// immediately before <GoogleTagManager> in the same layout: GTM's own loader
// is an afterInteractive script, so this plain inline script (executed as the
// HTML is parsed) always runs first. It does nothing for visitors who have not
// declined, so it leaves existing analytics behaviour untouched.
//
// The script body is a constant built from src/lib/marketing/consent.ts and
// contains no request or user data, so injecting it as raw HTML is safe.
export function ConsentDefaults() {
  return <script dangerouslySetInnerHTML={{ __html: consentDefaultsScript() }} />;
}
