"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFleetLiveAction } from "@/app/(app)/transport/live/actions";
import {
  POLL_INTERVAL_MS,
  ageSeconds,
  compassPoint,
  describeAge,
  mapLink,
  sortFleet,
  vehicleLiveness,
  type FleetVehicle,
  type Liveness,
} from "@/lib/bus-live";

const BADGE: Record<Liveness, { label: string; className: string }> = {
  live: { label: "Live", className: "bg-emerald-100 text-emerald-900" },
  stale: { label: "Not reporting", className: "bg-amber-100 text-amber-900" },
  never: { label: "No signal yet", className: "bg-muted text-muted-foreground" },
};

export function FleetLiveSection({ initialVehicles, initialFetchedAt }: { initialVehicles: FleetVehicle[]; initialFetchedAt: string }) {
  const [vehicles, setVehicles] = useState(initialVehicles);
  const [fetchedAt, setFetchedAt] = useState(initialFetchedAt);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await getFleetLiveAction();
      if ("error" in r) {
        setMessage(r.error);
      } else {
        setVehicles(r.vehicles);
        setFetchedAt(r.fetchedAt);
        setMessage(null);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Ask for fresh positions while the tab is visible; pause when it is hidden; catch up when it comes back.
  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_INTERVAL_MS);
    const tick = window.setInterval(() => setNow(new Date()), 10_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const sorted = sortFleet(vehicles, now);
  const liveCount = sorted.filter((v) => vehicleLiveness(v.recordedAt, now) === "live").length;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h1 className="text-lg font-semibold">Live vehicle view</h1>
        <p className="text-muted-foreground">
          The latest position each vehicle&apos;s driver phone has shared. A vehicle shows as live while it reported in the last 10 minutes. Positions are
          for school staff only unless parent bus view is switched on.
        </p>
      </div>

      {message && (
        <p role="alert" className="panel border-destructive p-3 text-destructive">
          {message}
        </p>
      )}

      <p className="text-muted-foreground" aria-live="polite">
        {vehicles.length === 0 ? "No vehicles yet." : `${liveCount} of ${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"} live.`} Updated{" "}
        {describeAge(ageSeconds(fetchedAt, now))}.{" "}
        <button type="button" className="underline" onClick={() => void refresh()}>
          Refresh now
        </button>
      </p>

      {sorted.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Vehicle</th>
                <th className="p-3">Route</th>
                <th className="p-3">Status</th>
                <th className="p-3">Last seen</th>
                <th className="p-3">Speed</th>
                <th className="p-3">Heading</th>
                <th className="p-3">Map</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((v) => {
                const liveness = vehicleLiveness(v.recordedAt, now);
                const badge = BADGE[liveness];
                const link = liveness === "never" ? null : mapLink(v.lat, v.lng);
                const heading = compassPoint(v.heading);
                return (
                  <tr key={v.vehicleId} className="border-b last:border-0">
                    <td className="p-3 font-medium">{v.registration}</td>
                    <td className="p-3">{v.routeName ?? "No route"}</td>
                    <td className="p-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
                    </td>
                    <td className="p-3">{describeAge(ageSeconds(v.recordedAt, now))}</td>
                    <td className="p-3">{liveness === "live" && v.speedKph !== null ? `${Math.round(v.speedKph)} km/h` : "-"}</td>
                    <td className="p-3">{liveness === "live" && heading ? heading : "-"}</td>
                    <td className="p-3">
                      {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="underline">
                          Open map
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        &quot;Open map&quot; opens OpenStreetMap in a new tab. No map is loaded on this page, so positions are not sent to a third party unless you open one.
      </p>
    </div>
  );
}
