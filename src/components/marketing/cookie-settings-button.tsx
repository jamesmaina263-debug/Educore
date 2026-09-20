"use client";

import { OPEN_COOKIE_SETTINGS_EVENT } from "@/lib/marketing/consent";

// Footer control that re-opens the cookie notice so a visitor can change an
// earlier Accept/Decline. Lives apart from the footer (a server component) so
// only this button ships client JS.
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT))}
    >
      Cookie settings
    </button>
  );
}
