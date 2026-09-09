"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/log-admin-action";

type ActionResult = { error: string } | { success: true };

// Key is derived from the label client-side (lowercase, dashes) and passed in rather than
// re-derived here, so the admin sees exactly what key they're about to create before
// submitting. The DB's case-insensitive unique index on key is still the real guard against a
// collision (e.g. two flags that only differ by case) -- this just surfaces that as a normal
// form error via Postgres's own message.
export async function createFeatureFlag(key: string, label: string, description: string): Promise<ActionResult> {
  const trimmedKey = key.trim();
  const trimmedLabel = label.trim();
  if (!trimmedKey || !trimmedLabel) return { error: "Key and label are required." };
  if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(trimmedKey)) {
    return { error: "Key must be lowercase letters, numbers, and underscores only (e.g. cbc_pilot)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("platform_feature_flags").insert({
    key: trimmedKey,
    label: trimmedLabel,
    description: description.trim() || null,
    created_by: user?.id ?? null,
  });
  if (error) {
    if (error.code === "23505") return { error: `A flag with key "${trimmedKey}" already exists.` };
    return { error: error.message };
  }
  void logAdminAction(supabase, "create_feature_flag", { key: trimmedKey, label: trimmedLabel });
  revalidatePath("/admin/feature-flags");
  return { success: true };
}

// Upsert rather than update -- most school/flag pairs have no row yet (absence = off), so the
// first toggle for a given school+flag needs to create the row, not fail trying to update one
// that was never inserted.
export async function setSchoolFeatureFlag(schoolId: string, flagId: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("school_feature_flags")
    .upsert(
      { school_id: schoolId, flag_id: flagId, enabled, updated_at: new Date().toISOString(), updated_by: user?.id ?? null },
      { onConflict: "school_id,flag_id" },
    );
  if (error) return { error: error.message };
  void logAdminAction(supabase, "set_school_feature_flag", { school_id: schoolId, flag_id: flagId, enabled });
  revalidatePath("/admin/feature-flags");
  return { success: true };
}

export async function deleteFeatureFlag(flagId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("platform_feature_flags").delete().eq("id", flagId);
  if (error) return { error: error.message };
  void logAdminAction(supabase, "delete_feature_flag", { flag_id: flagId });
  revalidatePath("/admin/feature-flags");
  return { success: true };
}
