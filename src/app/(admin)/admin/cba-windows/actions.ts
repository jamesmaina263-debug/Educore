"use server";

// Plain table writes (not RPCs) on purpose -- knec_cba_assessment_windows RLS is a straight
// auth_is_super_admin() check for insert/update/delete (see
// 20260903071500_knec_cba_assessment_window_reminders.sql), same shape as the whitelabel admin
// actions. No school-scoping concern here since this is global reference data.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export interface CbaWindowInput {
  title: string;
  gradeLabels: string[]; // empty = applies to every grade
  opensAt: string | null; // ISO date or null
  closesAt: string; // ISO date
  notes: string | null;
  sourceUrl: string | null;
}

export async function createCbaWindow(input: CbaWindowInput): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: actor } = await supabase
    .from("school_users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!actor) return { error: "Could not resolve your staff account." };

  const { error } = await supabase.from("knec_cba_assessment_windows").insert({
    title: input.title.trim(),
    grade_labels: input.gradeLabels.length > 0 ? input.gradeLabels : null,
    opens_at: input.opensAt,
    closes_at: input.closesAt,
    notes: input.notes?.trim() || null,
    source_url: input.sourceUrl?.trim() || null,
    created_by: actor.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/cba-windows");
  return { success: true as const };
}

export async function updateCbaWindow(id: string, input: CbaWindowInput): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("knec_cba_assessment_windows")
    .update({
      title: input.title.trim(),
      grade_labels: input.gradeLabels.length > 0 ? input.gradeLabels : null,
      opens_at: input.opensAt,
      closes_at: input.closesAt,
      notes: input.notes?.trim() || null,
      source_url: input.sourceUrl?.trim() || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/cba-windows");
  return { success: true as const };
}

export async function setCbaWindowActive(id: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("knec_cba_assessment_windows").update({ is_active: isActive }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/cba-windows");
  return { success: true as const };
}
