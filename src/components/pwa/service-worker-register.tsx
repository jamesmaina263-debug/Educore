"use client";

import { useEffect } from "react";

/**
 * Registers the app-shell service worker (see public/sw.js). Renders
 * nothing -- this only exists to run the registration side effect once,
 * on the client, after the page has hydrated.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Best-effort: an install-time failure here (e.g. unsupported browser,
      // dev-mode quirks) should never block the app from working normally.
    });
  }, []);

  return null;
}
