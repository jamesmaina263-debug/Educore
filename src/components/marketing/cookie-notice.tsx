"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { MarketingButton } from "@/components/marketing/button";
import { clearStoredClickIds } from "@/lib/attribution";
import {
  OPEN_COOKIE_SETTINGS_EVENT,
  clearGoogleCookies,
  getConsentSnapshot,
  getServerConsentSnapshot,
  pushConsentUpdate,
  subscribeToConsent,
  writeConsentChoice,
  type ConsentChoice,
} from "@/lib/marketing/consent";

// Cookie notice for the marketing site and /signup. See
// src/lib/marketing/consent.ts for the model (notice-and-opt-out, wired to
// Google Consent Mode) and why it is not deny-by-default.
//
// Shown only when no choice has been recorded, or when the footer's "Cookie
// settings" button asks for it. Accept and Decline are equally prominent
// buttons; the site works identically either way.
export function CookieNotice() {
  // "server" while prerendering/hydrating (renders nothing, so the static HTML
  // is unchanged), then "unset" | "accepted" | "declined" from localStorage.
  const choice = useSyncExternalStore(
    subscribeToConsent,
    getConsentSnapshot,
    getServerConsentSnapshot,
  );
  // Set by the footer's "Cookie settings" button to re-open the notice after a
  // choice has already been made.
  const [reopened, setReopened] = useState(false);

  useEffect(() => {
    const reopen = () => setReopened(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
  }, []);

  const open = choice === "unset" || (reopened && choice !== "server");

  function choose(next: ConsentChoice) {
    writeConsentChoice(next);
    pushConsentUpdate(next);
    if (next === "declined") {
      clearGoogleCookies();
      clearStoredClickIds();
    }
    setReopened(false);
  }

  if (!open) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 sm:inset-x-auto sm:bottom-4 sm:left-4 sm:px-0"
    >
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-marketing-navy-950 p-4 text-white shadow-xl">
        <p className="text-sm text-white/80">
          We use cookies to measure how this site and our Google ads perform. The site works the
          same if you decline.{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-white">
            Privacy Policy
          </Link>
        </p>
        <div className="mt-3 flex gap-3">
          <MarketingButton size="sm" className="flex-1" onClick={() => choose("accepted")}>
            Accept
          </MarketingButton>
          <MarketingButton
            size="sm"
            variant="outline-on-dark"
            className="flex-1"
            onClick={() => choose("declined")}
          >
            Decline
          </MarketingButton>
        </div>
      </div>
    </div>
  );
}
