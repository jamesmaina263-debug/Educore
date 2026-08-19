import { idbDelete, idbGetAll, idbPut, STORES } from "./db";
import { submitAttendance } from "@/app/(app)/attendance/actions";

export interface QueuedAttendanceSubmission {
  id: string; // client-generated, so a retry never double-submits
  stream_id: string;
  attendance_date: string;
  marks: { student_id: string; status: "present" | "absent" | "late" }[];
  queued_at: string;
  status: "pending" | "syncing" | "failed";
  last_error?: string;
}

export async function queueAttendanceSubmission(
  input: Omit<QueuedAttendanceSubmission, "id" | "queued_at" | "status">,
): Promise<QueuedAttendanceSubmission> {
  const record: QueuedAttendanceSubmission = {
    ...input,
    id: crypto.randomUUID(),
    queued_at: new Date().toISOString(),
    status: "pending",
  };
  await idbPut(STORES.pendingAttendance, record);
  return record;
}

export async function getPendingAttendanceSubmissions(): Promise<QueuedAttendanceSubmission[]> {
  return idbGetAll<QueuedAttendanceSubmission>(STORES.pendingAttendance);
}

/**
 * Flushes every queued submission to the server, in the order queued.
 * Each success removes that record from the queue immediately, so a
 * failure partway through (connection drops again mid-sync) never loses
 * or re-sends work already confirmed by the server.
 */
export async function syncPendingAttendance(): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingAttendanceSubmissions();
  let synced = 0;
  let failed = 0;

  for (const submission of pending) {
    await idbPut(STORES.pendingAttendance, { ...submission, status: "syncing" });
    try {
      const result = await submitAttendance({
        stream_id: submission.stream_id,
        attendance_date: submission.attendance_date,
        marks: submission.marks,
      });
      if ("error" in result) {
        await idbPut(STORES.pendingAttendance, { ...submission, status: "failed", last_error: result.error });
        failed += 1;
      } else {
        await idbDelete(STORES.pendingAttendance, submission.id);
        synced += 1;
      }
    } catch (e) {
      // Network failed again mid-sync -- leave it pending (not failed) so
      // the next online event retries automatically without user action.
      await idbPut(STORES.pendingAttendance, { ...submission, status: "pending" });
      failed += 1;
      if (e instanceof TypeError) break; // likely offline again; stop this pass
    }
  }

  return { synced, failed };
}
