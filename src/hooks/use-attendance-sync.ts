"use client";

import { useCallback, useEffect, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { getLastSyncedAt } from "@/lib/offline/queue";
import {
  getPendingAttendanceSubmissions,
  syncPendingAttendance,
  discardFailedSubmission,
  type QueuedAttendanceSubmission,
} from "@/lib/offline/attendance-queue";

// OS-04: getLastSyncedAt("attendance") reads the same generic record
// syncPendingAttendance() (a thin wrapper around the shared
// syncPendingMutations) already writes under the "attendance" module key --
// no separate tracking needed here, same as every other module.
export function useAttendanceSync() {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [failed, setFailed] = useState<QueuedAttendanceSubmission[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAtState] = useState<number | undefined>(undefined);

  const refreshCounts = useCallback(() => {
    return getPendingAttendanceSubmissions()
      .then((pending) => {
        setPendingCount(pending.filter((p) => p.status !== "failed").length);
        setFailed(pending.filter((p) => p.status === "failed"));
      })
      .catch(() => {
        setPendingCount(0);
        setFailed([]);
      });
  }, []);

  const refreshLastSynced = useCallback(() => {
    getLastSyncedAt("attendance")
      .then(setLastSyncedAtState)
      .catch(() => undefined);
  }, []);

  // Manual "Retry now" button calls this directly from a click handler --
  // setState there is a normal user-triggered update, not subject to the
  // effect restriction below.
  const sync = useCallback(() => {
    setSyncing(true);
    syncPendingAttendance().finally(() => {
      setSyncing(false);
      refreshCounts();
      refreshLastSynced();
    });
  }, [refreshCounts, refreshLastSynced]);

  const discard = useCallback(
    (id: string) => {
      discardFailedSubmission(id).finally(() => refreshCounts());
    },
    [refreshCounts],
  );

  // Mount: read the current queue length once, plus the last-synced time
  // already recorded on this device.
  useEffect(() => {
    let cancelled = false;
    getPendingAttendanceSubmissions()
      .then((pending) => {
        if (cancelled) return;
        setPendingCount(pending.filter((p) => p.status !== "failed").length);
        setFailed(pending.filter((p) => p.status === "failed"));
      })
      .catch(() => {
        if (!cancelled) {
          setPendingCount(0);
          setFailed([]);
        }
      });
    getLastSyncedAt("attendance")
      .then((value) => {
        if (!cancelled) setLastSyncedAtState(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Connectivity restored: auto-sync the queue. Same pattern -- the directly
  // (synchronously) called function is a plain imported utility; every
  // setState call is deferred into a .then()/.finally() callback.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    syncPendingAttendance().finally(() => {
      if (cancelled) return;
      refreshCounts();
      refreshLastSynced();
    });
    return () => {
      cancelled = true;
    };
  }, [online, refreshCounts, refreshLastSynced]);

  return { online, pendingCount, failed, syncing, sync, discard, lastSyncedAt };
}

