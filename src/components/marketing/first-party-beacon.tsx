"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { clickPlatformFromSearch } from "@/lib/marketing/page-view";

// Our own anonymous page-view counter (see /api/page-view and the migration
// 20261017210000_first_party_page_views.sql). Sends one small beacon per page view of the public
// marketing site and the free-trial sign-up page. It is separate from Google Analytics on purpose:
// the admin console reads it for same-day numbers, since Google's daily reports trail by hours.
//
// What this does NOT do: it sets no cookie, writes nothing to localStorage/sessionStorage, and
// never sends the ad click id (gclid/fbclid...) -- only which network's id was present. It honours
// the browser's Do Not Track and Global Privacy Control signals by sending nothing at all.
//
// "First view" is tracked in a module variable, not storage: it is true once per full page load,
// which is exactly when document.referrer and the landing URL's campaign tags describe how the
// visitor arrived. Later in-app navigations are plain page views.
let sentFirstView = false;

type PrivacyNavigator = Navigator & { globalPrivacyControl?: boolean };

function privacySignalOn(): boolean {
  const nav = navigator as PrivacyNavigator;
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

export function FirstPartyBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    try {
      if (privacySignalOn()) return;
      const isEntry = !sentFirstView;
      sentFirstView = true;

      const params = new URLSearchParams(window.location.search);
      const body = JSON.stringify({
        path: pathname,
        isEntry,
        referrer: isEntry ? document.referrer : "",
        utmSource: isEntry ? params.get("utm_source") : null,
        utmMedium: isEntry ? params.get("utm_medium") : null,
        utmCampaign: isEntry ? params.get("utm_campaign") : null,
        click: isEntry ? clickPlatformFromSearch(params) : null,
      });

      const queued =
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon("/api/page-view", new Blob([body], { type: "application/json" }));
      if (!queued) {
        void fetch("/api/page-view", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Counting must never affect the page.
    }
  }, [pathname]);

  return null;
}
