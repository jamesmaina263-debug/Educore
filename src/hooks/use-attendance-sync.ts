"use client";

import { useCallback, useEffect, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  getPendingAttendanceSubmissions,
  syncPendingAttendance,
  discardFailedSubmission,
  type QueuedAttendanceSubmission,
} from "@/lib/offline/attendance-queue";

export function useAttendanceSync() {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [failed, setFailed] = useState<QueuedAttendanceSubmission[]>([]);
  const [syncing, setSyncing] = useState(false);

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

  // Manual "Retry now" button calls this directly from a click handler --
  // setState there is a normal user-triggered update, not subject to the
  // effect restriction below.
  const sync = useCallback(() => {
    setSyncing(true);
    syncPendingAttendance().finally(() => {
      setSyncing(false);
      refreshCounts();
    });
  }, [refreshCounts]);

  const discard = useCallback(
    (id: string) => {
      discardFailedSubmission(id).finally(() => refreshCounts());
    },
    [refreshCounts],
  );

  // Mount: read the current queue length once.
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
    });
    return () => {
      cancelled = true;
    };
  }, [online, refreshCounts]);

  return { online, pendingCount, failed, syncing, sync, discard };
}

