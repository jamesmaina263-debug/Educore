// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2.112.4";

// The one gate every student-scoped tool call goes through, called by the dispatcher immediately
// before invoking a tool -- not just once when the conversation starts. resolveChildContext
// already picks from a list that's scoped to (guardianUserId, schoolId), so in the normal flow
// this is re-confirming something already true; the point is defense in depth against a stale
// student_id cursor on the conversation row (e.g. a guardian-student link removed after the
// cursor was set) and against any future code path that resolves a student_id some other way
// (natural-language reference across turns, a future channel adapter, etc.) without going through
// childContext.ts at all. Every tool's run() can assume this has already passed -- tools
// themselves don't re-check it.
export async function guardianCanAccessStudent(
  supabase: SupabaseClient<any, any, any>,
  guardianUserId: string,
  studentId: string,
  schoolId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("student_guardians")
    .select("student_id, students!inner(school_id)")
    .eq("guardian_user_id", guardianUserId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (error || !data) return false;
  const student = data.students as unknown as { school_id: string } | null;
  return student?.school_id === schoolId;
}
