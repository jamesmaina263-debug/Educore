"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_POINTS_PER_BATCH,
  isValidToken,
  nextBatch,
  pointFromGeolocation,
  shouldKeep,
  trimQueue,
  type TrackPoint,
} from "@/lib/driver-tracker";

const TOKEN_KEY = "educore.driver.token";
const FLUSH_MS = 15_000;

interface RouteInfo {
  vehicle: { registration_number: string; capacity: number };
  route: { name: string } | null;
  stops: { name: string; sequence: number; pickup_time: string | null; riders: number }[];
  riders_total: number;
  riders_without_stop: number;
  device_label: string;
}

type Phase = "need_token" | "loading" | "ready" | "sharing";

function readToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function DriverTracker() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [tokenInput, setTokenInput] = useState("");
  const [info, setInfo] = useState<RouteInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(0);
  const [queued, setQueued] = useState(0);

  const tokenRef = useRef<string | null>(null);
  const queueRef = useRef<TrackPoint[]>([]);
  const lastKeptRef = useRef<number | null>(null);
  const watchRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);

  const loadRoute = useCallback(async (token: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/driver/route", { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (res.status === 401) { setMessage("This code is not valid or was switched off. Ask the school for a new one."); setPhase("need_token"); return false; }
      if (res.status === 403) { setMessage("Live tracking is not switched on for your school."); setPhase("need_token"); return false; }
      if (!res.ok) { setMessage("Could not reach the server. Check your connection and try again."); setPhase("need_token"); return false; }
      setInfo((await res.json()) as RouteInfo);
      tokenRef.current = token;
      setMessage(null);
      setPhase("ready");
      return true;
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
      setPhase("need_token");
      return false;
    }
  }, []);

  useEffect(() => {
    // Deferred so the browser-only token read never sets state during the effect body (and never runs on the server).
    const id = setTimeout(() => {
      const t = readToken();
      if (t && isValidToken(t)) void loadRoute(t);
      else setPhase("need_token");
    }, 0);
    return () => clearTimeout(id);
  }, [loadRoute]);

  const flush = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || queueRef.current.length === 0) return;
    const { batch, rest } = nextBatch(queueRef.current, MAX_POINTS_PER_BATCH);
    try {
      const res = await fetch("/api/driver/positions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ points: batch }),
        cache: "no-store",
      });
      if (res.ok) {
        queueRef.current = rest;
        const body = (await res.json()) as { accepted?: number; duplicates?: number };
        setSent((n) => n + (body.accepted ?? 0) + (body.duplicates ?? 0));
      } else if (res.status === 401 || res.status === 403) {
        stopSharing();
        setMessage("Sharing stopped: the school switched this code off. Ask for a new one.");
      } else if (res.status === 400) {
        queueRef.current = rest; // bad batch: drop it rather than retry forever
      }
    } catch {
      // offline: keep the points and retry on the next tick
    }
    setQueued(queueRef.current.length);
  }, []);

  function stopSharing() {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    void wakeRef.current?.release().catch(() => undefined);
    wakeRef.current = null;
    setPhase((p) => (p === "sharing" ? "ready" : p));
  }

  async function startSharing() {
    if (!("geolocation" in navigator)) { setMessage("This phone cannot share its location from the browser."); return; }
    setMessage(null);
    lastKeptRef.current = null;
    watchRef.current = navigator.geolocation.watchPosition(
      (g) => {
        const p = pointFromGeolocation(g);
        if (!p) return;
        const at = Date.parse(p.t);
        if (!shouldKeep(lastKeptRef.current, at)) return;
        lastKeptRef.current = at;
        queueRef.current = trimQueue([...queueRef.current, p]);
        setQueued(queueRef.current.length);
      },
      (err) => {
        stopSharing();
        setMessage(err.code === err.PERMISSION_DENIED ? "Location permission was refused. Allow location for this page and try again." : "Could not get a location fix. Move to open sky and try again.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    timerRef.current = setInterval(() => void flush(), FLUSH_MS);
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (wl) wakeRef.current = await wl.request("screen");
    } catch { /* keeping the screen awake is a nicety, not required */ }
    setPhase("sharing");
  }

  useEffect(() => () => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  function forgetPhone() {
    stopSharing();
    try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    tokenRef.current = null;
    queueRef.current = [];
    setInfo(null);
    setSent(0);
    setQueued(0);
    setPhase("need_token");
  }

  async function saveToken() {
    const t = tokenInput.trim();
    if (!isValidToken(t)) { setMessage("That code does not look right. It starts with vt_ and is 67 characters long."); return; }
    setPhase("loading");
    if (await loadRoute(t)) {
      try { window.localStorage.setItem(TOKEN_KEY, t); } catch { /* storage blocked: works for this visit only */ }
      setTokenInput("");
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {message && <p role="alert" className="panel border-destructive p-3 text-destructive">{message}</p>}

      {phase === "loading" && <p className="text-muted-foreground">Loading…</p>}

      {phase === "need_token" && (
        <div className="panel space-y-3 p-3">
          <p>Enter the driver code the school gave you. You only need to do this once on this phone.</p>
          <input
            className="w-full rounded border bg-background px-2 py-2 font-mono text-xs"
            placeholder="vt_…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            aria-label="Driver code"
          />
          <button type="button" className="w-full rounded bg-primary px-3 py-2 text-primary-foreground" onClick={() => void saveToken()}>Continue</button>
        </div>
      )}

      {(phase === "ready" || phase === "sharing") && info && (
        <>
          <div className="panel space-y-1 p-3">
            <p className="font-medium">{info.vehicle.registration_number}</p>
            <p className="text-muted-foreground">{info.route ? `Route: ${info.route.name}` : "No route is set for this vehicle yet."}</p>
            <p className="text-muted-foreground">{info.riders_total} learner{info.riders_total === 1 ? "" : "s"} assigned{info.riders_without_stop > 0 ? ` (${info.riders_without_stop} without a stop)` : ""}.</p>
          </div>

          {info.stops.length > 0 && (
            <ol className="panel divide-y">
              {info.stops.map((s) => (
                <li key={`${s.sequence}-${s.name}`} className="flex items-center justify-between px-3 py-2">
                  <span><span className="mr-2 text-muted-foreground" data-numeric>{s.sequence}.</span>{s.name}{s.pickup_time ? <span className="ml-2 text-muted-foreground" data-numeric>{s.pickup_time}</span> : null}</span>
                  <span data-numeric>{s.riders}</span>
                </li>
              ))}
            </ol>
          )}

          {phase === "ready" ? (
            <div className="panel space-y-3 p-3">
              <p>
                When you tap Start, this phone shares the vehicle&apos;s location with your school so staff can see where the bus is. It shares only while this page is open and sharing is on, and you can stop at any time. Keep the screen on and the page open while driving.
              </p>
              <button type="button" className="w-full rounded bg-primary px-3 py-3 text-base text-primary-foreground" onClick={() => void startSharing()}>Start sharing location</button>
            </div>
          ) : (
            <div className="panel space-y-3 p-3">
              <p role="status">Sharing location. {sent} point{sent === 1 ? "" : "s"} sent{queued > 0 ? `, ${queued} waiting for a connection` : ""}.</p>
              <button type="button" className="w-full rounded border px-3 py-3 text-base" onClick={() => { void flush(); stopSharing(); }}>Stop sharing</button>
            </div>
          )}
          <button type="button" className="text-xs underline" onClick={forgetPhone}>Forget this phone</button>
        </>
      )}
    </div>
  );
}
