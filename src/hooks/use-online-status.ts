"use client";

import { useEffect, useState } from "react";

/**
 * Tracks connectivity via navigator.onLine plus the 'online'/'offline'
 * window events. Note navigator.onLine only reflects whether the device
 * has *a* network interface up (e.g. connected to wifi with no internet
 * still reports true) -- it's a reasonable, standard signal for "should we
 * attempt a sync," not a guarantee requests will succeed. Actual sync
 * attempts still need to handle failure regardless of this flag.
 */
export function useOnlineStatus(): boolean {
  // Read the real value during the initial render (lazy initializer) rather
  // than setState-ing it inside a mount effect. `navigator` doesn't exist
  // during server rendering, hence the guard -- corrected on the client's
  // first render before paint.
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}

