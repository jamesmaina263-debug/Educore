"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QueuedMutation } from "@/lib/offline/queue";

const MUTATION_LABELS: Record<string, string> = {
  submitRollCall: "Roll call",
  logIncident: "Incident log",
};

/**
 * The three offline-queue banners shared by boarding's write forms (roll
 * call, incidents) -- both share the "boarding" module queue, so staff see
 * one consistent count/status regardless of which tab queued something.
 * Mirrors src/components/health/offline-banner.tsx.
 */
export function BoardingOfflineBanner({
  online,
  pendingCount,
  failed,
  syncing,
  sync,
  discard,
}: {
  online: boolean;
  pendingCount: number;
  failed: QueuedMutation[];
  syncing: boolean;
  sync: () => void;
  discard: (id: string) => void;
}) {
  return (
    <>
      {!online && (
        <div className="panel flex items-center gap-2 border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning-foreground">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <span>You&apos;re offline. What you submit now is saved on this device and will sync automatically once you&apos;re back online.</span>
        </div>
      )}
      {online && pendingCount > 0 && (
        <div className="panel flex items-center gap-2 border-border bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
          <RefreshCw className={"size-4 shrink-0 " + (syncing ? "animate-spin" : "")} aria-hidden />
          <span>{syncing ? "Syncing offline entries…" : `${pendingCount} offline ${pendingCount === 1 ? "entry" : "entries"} waiting to sync.`}</span>
          {!syncing && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => sync()}>
              Retry now
            </Button>
          )}
        </div>
      )}
      {failed.length > 0 && (
        <div className="panel flex flex-col gap-2 border-danger/40 bg-danger/10 px-4 py-2.5 text-sm">
          <p className="font-medium text-danger">
            {failed.length} offline {failed.length === 1 ? "entry" : "entries"} couldn&apos;t sync and won&apos;t succeed by retrying.
          </p>
          {failed.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-3 py-1.5">
              <span className="text-muted-foreground">
                {MUTATION_LABELS[f.type] ?? f.type}
                {f.last_error ? ` — ${f.last_error}` : ""}
              </span>
              <Button size="sm" variant="ghost" onClick={() => discard(f.id)}>
                Discard
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
