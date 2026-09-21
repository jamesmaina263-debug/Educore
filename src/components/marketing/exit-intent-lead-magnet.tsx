"use client";

// Site-wide, low-friction lead capture: offers the CBC Digital Readiness
// Checklist (public/downloads/cbc-digital-readiness-checklist.pdf) in
// exchange for just an email address, triggered by exit-intent on desktop
// or a scroll-depth/dwell-time fallback on touch devices (mousleave near
// the top of the viewport doesn't fire meaningfully on touch). This exists
// specifically to capture visitors who browse the marketing site and leave
// without ever reaching /contact -- see the analytics conversation this
// came out of.
//
// Suppressed entirely on /contact: no reason to compete with the actual
// demo-request form there. Suppressed for 30 days after a dismiss, and
// indefinitely (no re-check) after a successful submission -- both via
// localStorage, not a cookie, so this carries no consent-banner
// implications and works identically whether or not the visitor is
// otherwise tracked.

import { useActionState, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { sendGTMEvent } from "@next/third-parties/google";
import { MarketingButton } from "@/components/marketing/button";
import { getStoredAttribution } from "@/lib/attribution";
import { ATTRIBUTION_KEYS } from "@/lib/marketing/attribution-fields";
import { submitLeadMagnet, type LeadMagnetState } from "@/app/(marketing)/lead-magnet-actions";

const STORAGE_KEY = "educore_lead_magnet_state";
const SUPPRESS_DISMISS_DAYS = 30;
const SCROLL_DEPTH_FALLBACK = 0.6; // 60% down the page
const DWELL_TIME_FALLBACK_MS = 25_000;
const DOWNLOAD_URL = "/downloads/cbc-digital-readiness-checklist.pdf";
const RESOURCE = "cbc_digital_readiness_checklist";

type StoredState = { suppressedUntil: number };

function readSuppression(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredState) : null;
  } catch {
    return null;
  }
}

function writeSuppression(days: number) {
  try {
    const suppressedUntil = Date.now() + days * 24 * 60 * 60 * 1000;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ suppressedUntil }));
  } catch {
    // localStorage can throw in some privacy modes -- suppression is a
    // politeness nicety, never worth breaking the page over. Worst case
    // the prompt can reappear sooner than intended for that one visitor.
  }
}

const initialState: LeadMagnetState = { status: "idle" };

export function ExitIntentLeadMagnet() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [state, formAction, pending] = useActionState(submitLeadMagnet, initialState);
  const [renderedAt] = useState(() => Date.now());

  const onContactPage = pathname?.startsWith("/contact") ?? false;

  useEffect(() => {
    if (onContactPage) return;

    const suppression = readSuppression();
    if (suppression && suppression.suppressedUntil > Date.now()) return;

    let triggered = false;
    const trigger = () => {
      if (triggered) return;
      triggered = true;
      setVisible(true);
      cleanup();
    };

    const isCoarsePointer =
      typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

    let scrollHandler: (() => void) | null = null;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    let mouseHandler: ((e: MouseEvent) => void) | null = null;

    if (isCoarsePointer) {
      // Touch devices: exit-intent has no equivalent, so use scroll depth
      // or a dwell timer, whichever comes first.
      scrollHandler = () => {
        const scrolled =
          window.scrollY / (document.documentElement.scrollHeight - window.innerHeight || 1);
        if (scrolled >= SCROLL_DEPTH_FALLBACK) trigger();
      };
      window.addEventListener("scroll", scrollHandler, { passive: true });
      dwellTimer = setTimeout(trigger, DWELL_TIME_FALLBACK_MS);
    } else {
      // Desktop: fire when the cursor exits toward the top of the
      // viewport -- the classic "about to close the tab / hit the URL
      // bar" signal.
      mouseHandler = (e: MouseEvent) => {
        if (e.clientY <= 0) trigger();
      };
      document.addEventListener("mouseleave", mouseHandler);
    }

    function cleanup() {
      if (scrollHandler) window.removeEventListener("scroll", scrollHandler);
      if (mouseHandler) document.removeEventListener("mouseleave", mouseHandler);
      if (dwellTimer) clearTimeout(dwellTimer);
    }

    return cleanup;
    // pathname is intentionally the only dependency: this should re-arm
    // (or tear down, for /contact) on navigation, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (state.status === "success") {
      writeSuppression(365); // effectively permanent -- don't re-prompt a converted visitor
      sendGTMEvent({ event: "Lead Magnet Submitted", resource: RESOURCE });
    }
  }, [state.status]);

  function handleDismiss() {
    writeSuppression(SUPPRESS_DISMISS_DAYS);
    setDismissed(true);
    setVisible(false);
  }

  if (onContactPage || !visible || dismissed) return null;

  const attribution = getStoredAttribution();

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="lead-magnet-heading"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:px-0"
    >
      <div className="w-full max-w-md rounded-lg border border-marketing-navy-900/10 bg-white p-5 shadow-xl sm:p-6">
        {state.status === "success" ? (
          <div className="flex flex-col gap-3">
            <p id="lead-magnet-heading" className="text-base font-semibold text-marketing-navy-950">
              Your checklist is ready
            </p>
            <p className="text-sm text-marketing-navy-900/80">
              Thanks — here&apos;s your copy.
            </p>
            <MarketingButton asChild size="sm" className="w-full">
              <a href={DOWNLOAD_URL} download>
                Download the checklist (PDF)
              </a>
            </MarketingButton>
            <button
              type="button"
              onClick={() => setVisible(false)}
              className="text-xs text-marketing-navy-900/60 hover:text-marketing-navy-900"
            >
              Close
            </button>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p id="lead-magnet-heading" className="text-base font-semibold text-marketing-navy-950">
                  Before you go — the CBC Digital Readiness Checklist
                </p>
                <p className="mt-1 text-sm text-marketing-navy-900/80">
                  A free 5-point self-assessment for Kenyan school admins. No spam, just the PDF.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss"
                className="shrink-0 text-marketing-navy-900/40 hover:text-marketing-navy-900"
              >
                ✕
              </button>
            </div>

            {/* Honeypot -- same pattern as demo-request-form.tsx: hidden from
                sighted users via CSS and never announced by a screen reader,
                so a human never fills it, but naive form-filling bots do. */}
            <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
              <label htmlFor="lead_magnet_company_website">Company website</label>
              <input
                id="lead_magnet_company_website"
                name="company_website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
              />
            </div>
            <input type="hidden" name="rendered_at" value={renderedAt} />
            <input type="hidden" name="resource" value={RESOURCE} />
            <input type="hidden" name="source_page" value={pathname ?? ""} />
            {ATTRIBUTION_KEYS.map((key) => (
              <input key={key} type="hidden" name={key} value={attribution[key] ?? ""} />
            ))}

            <input
              type="email"
              name="email"
              required
              placeholder="you@yourschool.ac.ke"
              className="h-10 w-full rounded-md border border-marketing-navy-900/15 bg-white px-3 text-sm text-marketing-navy-950 placeholder:text-marketing-navy-900/40 focus:border-marketing-gold-500 focus:outline-none focus:ring-2 focus:ring-marketing-gold-500/40"
            />

            {state.status === "error" && (
              <p className="text-sm text-red-600">{state.message}</p>
            )}

            <MarketingButton type="submit" size="sm" disabled={pending} className="w-full">
              {pending ? "Sending…" : "Get the checklist"}
            </MarketingButton>
          </form>
        )}
      </div>
    </div>
  );
}
