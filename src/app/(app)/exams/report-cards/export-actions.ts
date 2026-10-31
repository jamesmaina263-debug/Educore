"use server";

import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { loadMarkSheetModel } from "@/lib/academics/load-mark-sheet";
import type { MarkSheetModel } from "@/lib/academics/mark-sheet-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read-only. The mark sheet / merit list data is loaded when someone asks to export, not on every
// class page view. Same loader as before, under the caller's own session, so RLS (exams.read, school
// scoping) decides what comes back; this adds no permission logic of its own.
export async function getMarkSheetModel(examId: string, classId: string): Promise<{ error: string } | { model: MarkSheetModel }> {
  if (![examId, classId].every((v) => typeof v === "string" && UUID.test(v))) return { error: "Invalid request." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  try {
    const { data: schoolUser } = await supabase.from("school_users").select("full_name").eq("auth_user_id", user.id).maybeSingle();
    const model = await loadMarkSheetModel(supabase, { examId, classId, preparedBy: (schoolUser?.full_name as string | undefined) ?? null });
    if (!model) return { error: "Nothing to export for this class and exam." };
    return { model };
  } catch {
    return { error: "Couldn't prepare the export. Please try again." };
  }
}
