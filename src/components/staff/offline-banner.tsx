"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QueuedMutation } from "@/lib/offline/queue";

const MUTATION_LABELS: Record<string, string> = {
  submitStaffAttendance: "Staff attendance",
};

/** Mirrors src/components/health/offline-banner.tsx. */
export function StaffOfflineBanner({
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
          <span>
            You&apos;re offline. Marks you submit now are saved on this device and will sync automatically once
            you&apos;re back online.
          </span>
        </div>
      )}
      {online && pendingCount > 0 && (
        <div className="panel flex items-center gap-2 border-border bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
          <RefreshCw className={"size-4 shrink-0 " + (syncing ? "animate-spin" : "")} aria-hidden />
          <span>{syncing ? "Syncing offline attendance…" : `${pendingCount} offline submission${pendingCount === 1 ? "" : "s"} waiting to sync.`}</span>
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
            {failed.length} offline submission{failed.length === 1 ? "" : "s"} couldn&apos;t sync and won&apos;t
            succeed by retrying — usually because someone else already marked that day.
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
