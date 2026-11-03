"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ageSeconds, ageText, liveState, mapsUrl, speedText, type FleetRow } from "@/lib/fleet-live";

const REFRESH_MS = 15000;

export function FleetLive({ rows }: { rows: FleetRow[] }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());

  // Re-fetch the server data and re-render the "x ago" text while the page is open and visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
      setNow(Date.now());
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Live buses</h1>
        <p className="text-sm text-muted-foreground">
          Latest position from each vehicle&apos;s driver phone. Refreshes every {REFRESH_MS / 1000} seconds. A position older than 10 minutes is shown as not live.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">No vehicles yet. Add a vehicle on the Transport page.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => {
            const state = liveState(r, now);
            const url = mapsUrl(r.lat, r.lng);
            const age = ageSeconds(r.recorded_at, now);
            return (
              <div key={r.vehicle_id} className="panel flex flex-col gap-2 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{r.registration_number}</div>
                  <span
                    className={
                      state === "live"
                        ? "rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800"
                        : "rounded px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground"
                    }
                  >
                    {state === "live" ? "Live" : state === "stale" ? "Not live" : "No signal yet"}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">Route: {r.route_name ?? "none"}</div>
                {state !== "none" && (
                  <div className="text-sm">
                    Last seen {ageText(age)} · {speedText(r.speed_kph)}
                    {r.accuracy_m !== null ? ` · accuracy ±${Math.round(r.accuracy_m)} m` : ""}
                  </div>
                )}
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm underline">
                    {state === "live" ? "Open on map" : "Open last known position on map"}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
