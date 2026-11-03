"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBusStatusesAction } from "@/app/portal/bus/actions";
import { POLL_INTERVAL_MS, busStatusMessage, compassPoint, describeAge, mapLink, type GuardianBusStatus } from "@/lib/bus-live";

export interface BusChild {
  id: string;
  name: string;
}

export function BusStatusPanel({ learners, initial }: { learners: BusChild[]; initial: Record<string, GuardianBusStatus> }) {
  const [statuses, setStatuses] = useState(initial);
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);
  const ids = learners.map((c) => c.id);
  const idsKey = ids.join(",");

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await getBusStatusesAction(idsKey.split(",").filter(Boolean));
      if ("error" in r) {
        setProblem(r.error);
      } else {
        setStatuses(r.statuses);
        setReceivedAt(Date.now());
        setProblem(null);
      }
    } finally {
      inFlight.current = false;
    }
  }, [idsKey]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_INTERVAL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 5_000);
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

  // The position's age as of now: the age the database reported plus the time since we received it.
  const elapsed = Math.max(0, Math.floor((now - receivedAt) / 1000));

  return (
    <div className="space-y-3 text-sm" aria-live="polite">
      {problem && (
        <p role="alert" className="rounded border border-destructive p-3 text-destructive">
          {problem}
        </p>
      )}
      {learners.map((child) => {
        const status: GuardianBusStatus = statuses[child.id] ?? { status: "unavailable" };
        const link = status.status === "live" ? mapLink(status.lat, status.lng) : null;
        const heading = status.status === "live" ? compassPoint(status.heading) : null;
        return (
          <div key={child.id} className="rounded border p-3">
            <p className="font-medium">{child.name}</p>
            {status.status === "live" ? (
              <div className="mt-1 space-y-1">
                <p>
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">Bus is on the move</span>
                </p>
                <p className="text-muted-foreground">
                  {status.routeName ? `${status.routeName}. ` : ""}
                  {status.stop ? `Your child's stop: ${status.stop}. ` : ""}
                  Updated {describeAge(status.ageSeconds + elapsed)}.
                  {status.speedKph !== null ? ` About ${Math.round(status.speedKph)} km/h${heading ? ` heading ${heading}` : ""}.` : ""}
                </p>
                {link && (
                  <a href={link} target="_blank" rel="noopener noreferrer" className="inline-block underline underline-offset-2">
                    Open in map
                  </a>
                )}
              </div>
            ) : (
              <p className="mt-1 text-muted-foreground">{busStatusMessage(status)}</p>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">Updates about every 30 seconds while this page is open. &quot;Open in map&quot; opens OpenStreetMap in a new tab.</p>
    </div>
  );
}
