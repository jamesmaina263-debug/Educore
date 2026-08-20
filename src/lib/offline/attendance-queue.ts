// Thin, module-scoped wrapper around the generic offline queue (./queue.ts).
// Kept as its own file/export so use-attendance-sync.ts and
// register-form.tsx don't need to change, and other callers get
// attendance-shaped types instead of the generic QueuedMutation<unknown>.
import { discardMutation, getPendingMutations, queueMutation, syncPendingMutations } from "./queue";

export interface QueuedAttendanceSubmission {
  id: string; // client-generated, so a retry never double-submits
  stream_id: string;
  attendance_date: string;
  marks: { student_id: string; status: "present" | "absent" | "late" }[];
  queued_at: string;
  status: "pending" | "syncing" | "failed";
  last_error?: string;
}

type AttendancePayload = Omit<QueuedAttendanceSubmission, "id" | "queued_at" | "status" | "last_error">;

export async function queueAttendanceSubmission(input: AttendancePayload): Promise<QueuedAttendanceSubmission> {
  const record = await queueMutation("attendance", "submitAttendance", input);
  return { ...input, id: record.id, queued_at: record.queued_at, status: record.status };
}

export async function getPendingAttendanceSubmissions(): Promise<QueuedAttendanceSubmission[]> {
  const pending = await getPendingMutations<AttendancePayload>("attendance");
  return pending.map((m) => ({
    ...m.payload,
    id: m.id,
    queued_at: m.queued_at,
    status: m.status,
    last_error: m.last_error,
  }));
}

// A "failed" item (e.g. someone else already marked this stream/date while
// this device was offline, so the unique constraint rejects the insert)
// can never succeed by retrying -- retry just fails identically forever.
// This removes it from the local queue so the teacher can stop staring at
// a permanently-stuck banner; if the marks still need correcting, that's
// a normal edit through the register once the confirmed data is visible.
export async function discardFailedSubmission(id: string): Promise<void> {
  await discardMutation(id);
}

/**
 * Flushes every queued submission to the server, in the order queued.
 * Each success removes that record from the queue immediately, so a
 * failure partway through (connection drops again mid-sync) never loses
 * or re-sends work already confirmed by the server.
 */
export async function syncPendingAttendance(): Promise<{ synced: number; failed: number }> {
  return syncPendingMutations("attendance");
}
