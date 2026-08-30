"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

/**
 * Renders Cloudflare Turnstile (Managed mode) and reports the verified
 * token up to the parent so it can gate submission client-side. The token
 * itself is submitted to the server as the standard `cf-turnstile-response`
 * hidden input Turnstile injects into the enclosing <form> — the parent
 * doesn't need to do anything with the token besides know whether one
 * exists yet. The real, authoritative check happens server-side
 * (verifyTurnstileToken) — this widget only improves the client UX.
 *
 * Rendered explicitly (not via Turnstile's implicit `.cf-turnstile` class
 * scan) because implicit rendering races with React hydration when the
 * script loads after the element first mounts.
 */
export function TurnstileWidget({ onVerify }: { onVerify: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!scriptLoaded || !containerRef.current || !window.turnstile || !siteKey) return;
    if (widgetIdRef.current !== null) return; // already rendered

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token) => onVerify(token),
      "expired-callback": () => onVerify(""),
      "error-callback": () => onVerify(""),
    });
  }, [scriptLoaded, siteKey, onVerify]);

  if (!siteKey) {
    // Fails visibly in non-production environments that haven't set the key
    // yet, rather than silently letting the form submit with no CAPTCHA at
    // all (the server-side check would reject it anyway, but this is a
    // clearer signal during setup).
    return (
      <p className="text-xs text-danger">
        CAPTCHA is not configured (NEXT_PUBLIC_TURNSTILE_SITE_KEY is missing) — signup is disabled.
      </p>
    );
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />
      <div ref={containerRef} />
    </>
  );
}
