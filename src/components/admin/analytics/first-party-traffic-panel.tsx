"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BreakdownList } from "@/components/admin/analytics/breakdown-list";
import {
  countryLabel,
  deviceLabel,
  parsePageViewSummary,
  type PageViewSummary,
} from "@/lib/analytics-page-views";

const POLL_MS = 30_000;

// Our own visit counter (public.site_page_views), read through /api/admin/page-views. Unlike the
// Google Analytics cards, it has no processing delay and it also counts visitors who declined
// Google's cookies, so for "Today" this is the number to trust. It refreshes itself every 30 s
// while the range includes today and the tab is visible.
export function FirstPartyTrafficPanel({
  from,
  to,
  includesToday,
  initial,
}: {
  from: string;
  to: string;
  includesToday: boolean;
  initial: PageViewSummary | null;
}) {
  const [summary, setSummary] = useState<PageViewSummary | null>(initial);
  const [failed, setFailed] = useState(initial === null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const res = await fetch(`/api/admin/page-views?from=${from}&to=${to}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(String(res.status));
      const parsed = parsePageViewSummary(await res.json());
      if (!parsed) throw new Error("bad payload");
      setSummary(parsed);
      setFailed(false);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setFailed(true);
    }
  }, [from, to]);

  useEffect(() => {
    if (!includesToday) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      inFlight.current?.abort();
    };
  }, [includesToday, load]);

  const singleDay = from === to;
  const maxViews = Math.max(1, ...(summary?.series.map((b) => b.views) ?? [1]));
  const startedAfterRange = summary?.firstRecordedDay != null && summary.firstRecordedDay > from;

  return (
    <section className="flex flex-col gap-3" aria-label="Our own visit counter">
      <div>
        <h2 className="text-base font-semibold">Visits counted by EduCore</h2>
        <p className="text-xs text-muted-foreground">
          Our own anonymous counter: no delay, and it includes visitors who declined Google&apos;s cookies.
          Bots and visitors who send Do Not Track are not counted.
        </p>
      </div>

      {!summary ? (
        <div className="panel p-4 text-sm text-muted-foreground">
          {failed
            ? "The visit counter is not available yet. It starts counting once its database table has been set up."
            : "Loading…"}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Page views" value={summary.views} />
            <Kpi label={singleDay ? "Visitors" : "Visitors (sum of daily)"} value={summary.visitors} />
            <Kpi label="Visits from ads" value={summary.adVisits} />
          </div>

          {summary.firstRecordedDay === null ? (
            <p className="text-xs text-muted-foreground">
              Nothing recorded yet. Counting begins with the first visit after this feature went live.
            </p>
          ) : startedAfterRange ? (
            <p className="text-xs text-muted-foreground">
              Counting started on {summary.firstRecordedDay}, so days before that show nothing here.
            </p>
          ) : null}

          {summary.series.length > 0 && (
            <div className="panel p-4">
              <p className="mb-3 text-sm font-medium">{singleDay ? "Page views by hour" : "Page views by day"}</p>
              <div className="flex h-24 items-end gap-0.5" role="img" aria-label="Page views over time">
                {summary.series.map((b) => (
                  <div
                    key={b.bucket}
                    className="min-w-[2px] flex-1 rounded-t bg-primary/70"
                    style={{ height: `${Math.max(2, (b.views / maxViews) * 100)}%` }}
                    title={`${b.bucket}: ${b.views} views, ${b.visitors} visitors`}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <BreakdownList title="Top pages" rows={summary.topPages} valueLabel="Views" />
            <BreakdownList title="How they arrived" rows={summary.sources} valueLabel="Visits" />
            <BreakdownList
              title="Countries"
              rows={summary.countries.map((r) => ({ ...r, label: countryLabel(r.label) }))}
              valueLabel="Views"
            />
            <BreakdownList
              title="Devices"
              rows={summary.devices.map((r) => ({ ...r, label: deviceLabel(r.label) }))}
              valueLabel="Views"
            />
          </div>
        </>
      )}
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString("en-US")}</p>
    </div>
  );
}
