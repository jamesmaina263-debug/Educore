"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tracks connectivity via navigator.onLine plus the 'online'/'offline'
 * window events. Note navigator.onLine only reflects whether the device
 * has *a* network interface up (e.g. connected to wifi with no internet
 * still reports true) -- it's a reasonable, standard signal for "should we
 * attempt a sync," not a guarantee requests will succeed. Actual sync
 * attempts still need to handle failure regardless of this flag.
 *
 * Going offline is debounced: a brief interface blip (weak wifi signal, a
 * VPN reconnecting, a router hiccup) fires a real 'offline' event even
 * though the connection recovers a second later, and reflecting that
 * directly made every offline banner in the app flicker on and off for
 * users who were, in practice, online the whole time. Coming back online
 * is reported immediately -- there's no reason to delay good news, and no
 * flicker risk in that direction since a single 'online' event is
 * trustworthy on its own.
 */
const OFFLINE_DEBOUNCE_MS = 2000;

export function useOnlineStatus(): boolean {
  // Read the real value during the initial render (lazy initializer) rather
  // than setState-ing it inside a mount effect. `navigator` doesn't exist
  // during server rendering, hence the guard -- corrected on the client's
  // first render before paint.
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearPendingOffline() {
      if (offlineTimer.current !== null) {
        clearTimeout(offlineTimer.current);
        offlineTimer.current = null;
      }
    }
    function handleOnline() {
      clearPendingOffline();
      setOnline(true);
    }
    function handleOffline() {
      clearPendingOffline();
      // Don't flip to offline on the first event -- only after it's held
      // for OFFLINE_DEBOUNCE_MS with no intervening 'online' event.
      offlineTimer.current = setTimeout(() => setOnline(false), OFFLINE_DEBOUNCE_MS);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      clearPendingOffline();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}

