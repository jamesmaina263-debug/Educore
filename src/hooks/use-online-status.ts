"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tracks connectivity. navigator.onLine's 'offline' event alone turned out
 * to be too unreliable to show a banner from directly -- it fires on any
 * network-interface blip (weak wifi signal, a VPN reconnecting, a captive
 * portal re-auth, a router hiccup), including cases seen in practice where
 * it fires with the device still genuinely connected to the internet the
 * whole time. A 2s debounce alone wasn't enough for some of those, so this
 * now backs every 'offline' signal with an actual network probe -- a
 * same-origin fetch that bypasses HTTP cache -- before believing it. If
 * the probe succeeds, the browser's 'offline' event was wrong and is
 * ignored outright. If it also fails, only then does the banner show, and
 * a short recheck loop keeps probing (independent of the 'online' event,
 * in case that also doesn't fire reliably in whatever network condition
 * caused this) until connectivity is confirmed restored.
 *
 * Coming back online is still reported immediately on the 'online' event
 * with no probe -- there's no flicker risk in that direction, and no
 * reason to delay good news behind a network round trip.
 */
const OFFLINE_DEBOUNCE_MS = 2000;
const PROBE_TIMEOUT_MS = 4000;
const RECHECK_INTERVAL_MS = 5000;
// Any small, always-present, same-origin static file works -- this one is
// already part of the PWA manifest, so it isn't a request whose absence
// would itself be surprising.
const PROBE_URL = "/manifest.webmanifest";

async function probeConnectivity(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // no-store: a cached response would defeat the entire point of this
    // probe, since the goal is "can we reach the network right now," not
    // "do we have this file already."
    const res = await fetch(PROBE_URL, { method: "HEAD", cache: "no-store", signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function useOnlineStatus(): boolean {
  // Read the real value during the initial render (lazy initializer) rather
  // than setState-ing it inside a mount effect. `navigator` doesn't exist
  // during server rendering, hence the guard -- corrected on the client's
  // first render before paint.
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recheckTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against a slow probe resolving after a newer event already
  // decided the answer (e.g. 'online' fires while an 'offline' probe from
  // a moment earlier is still in flight).
  const generation = useRef(0);

  useEffect(() => {
    function clearAllTimers() {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      if (recheckTimer.current !== null) {
        clearInterval(recheckTimer.current);
        recheckTimer.current = null;
      }
    }

    function startRecheckLoop() {
      if (recheckTimer.current !== null) return;
      const myGeneration = generation.current;
      recheckTimer.current = setInterval(async () => {
        const reachable = await probeConnectivity();
        if (myGeneration !== generation.current) return; // superseded
        if (reachable) {
          setOnline(true);
          clearAllTimers();
        }
      }, RECHECK_INTERVAL_MS);
    }

    function handleOnline() {
      generation.current += 1;
      clearAllTimers();
      setOnline(true);
    }

    function handleOffline() {
      clearAllTimers();
      const myGeneration = generation.current;
      debounceTimer.current = setTimeout(async () => {
        const reachable = await probeConnectivity();
        if (myGeneration !== generation.current) return; // superseded by an 'online' event meanwhile
        if (reachable) return; // false alarm -- browser's flag was wrong, stay online
        setOnline(false);
        startRecheckLoop();
      }, OFFLINE_DEBOUNCE_MS);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      generation.current += 1;
      clearAllTimers();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}

