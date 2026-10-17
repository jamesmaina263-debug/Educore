"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BreakdownList } from "@/components/admin/analytics/breakdown-list";

type Row = { label: string; value: number };
type Snapshot = {
  activeUsers: number;
  pageViews: number;
  perMinute: number[];
  topPages: Row[];
  locations: Row[];
  devices: Row[];
  events: Row[];
  fetchedAt: string;
};

const POLL_MS = 30_000;

// Live view of the marketing site, fed by GA4's Realtime API through /api/admin/analytics-live.
// The rest of this page uses GA4's standard reports, which can trail real traffic by hours; this
// panel is the part that answers "is anyone on the site right now". It refreshes itself every
// 30 seconds while the tab is visible, and stops polling while it is hidden.
export function LiveVisitorsPanel({ initialActiveUsers }: { initialActiveUsers: number | null }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const res = await fetch("/api/admin/analytics-live", { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(String(res.status));
      setSnapshot((await res.json()) as Snapshot);
      setFailed(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      void load();
      timer = setInterval(() => void load(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      stop();
      if (document.visibilityState === "visible") start();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      inFlight.current?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  // Ticks the "updated Ns ago" label.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  const active = snapshot?.activeUsers ?? initialActiveUsers;
  const ageSeconds = snapshot ? Math.max(0, Math.round((now - new Date(snapshot.fetchedAt).getTime()) / 1000)) : null;
  const bars = snapshot ? [...snapshot.perMinute].reverse() : [];
  const maxBar = Math.max(1, ...bars);

  return (
    <section className="flex flex-col gap-3" aria-label="Live visitors">
      <div className="panel flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="label-eyebrow flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span
                className={`absolute inline-flex h-full w-full rounded-full ${failed ? "bg-destructive" : "animate-ping bg-success opacity-75"}`}
              />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${failed ? "bg-destructive" : "bg-success"}`} />
            </span>
            Live &middot; last 30 minutes
          </p>
          <p className="text-xs text-muted-foreground">
            {failed
              ? "Couldn't reach Google Analytics — retrying"
              : ageSeconds === null
                ? "Loading…"
                : `Updated ${ageSeconds < 5 ? "just now" : `${ageSeconds}s ago`} · refreshes every 30s`}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-3xl font-semibold tabular-nums">{active ?? "—"}</p>
            <p className="text-xs text-muted-foreground">active visitor{active === 1 ? "" : "s"}</p>
          </div>
          <div>
            <p className="text-3xl font-semibold tabular-nums">{snapshot ? snapshot.pageViews : "—"}</p>
            <p className="text-xs text-muted-foreground">page views</p>
          </div>
          {snapshot && (
            <div className="min-w-[160px] flex-1">
              <div className="flex h-12 items-end gap-[2px]" role="img" aria-label="Active visitors per minute, oldest to newest">
                {bars.map((value, i) => (
                  <span
                    key={i}
                    title={`${30 - 1 - i === 0 ? "This minute" : `${30 - 1 - i} min ago`}: ${value}`}
                    className="flex-1 rounded-sm bg-primary/70"
                    style={{ height: `${value === 0 ? 4 : Math.max(12, (value / maxBar) * 100)}%`, opacity: value === 0 ? 0.25 : 1 }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>30 min ago</span>
                <span>now</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {snapshot && (
        <div className="grid gap-3 md:grid-cols-2">
          <BreakdownList title="Pages being viewed" rows={snapshot.topPages} valueLabel="Views" />
          <BreakdownList title="Where they are" rows={snapshot.locations} valueLabel="Visitors" />
          <BreakdownList title="Devices" rows={snapshot.devices} valueLabel="Visitors" />
          <BreakdownList title="Events firing" rows={snapshot.events} valueLabel="Events" />
        </div>
      )}
    </section>
  );
}
