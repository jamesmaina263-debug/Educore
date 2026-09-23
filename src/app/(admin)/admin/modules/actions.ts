"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";

type ActionResult = { error: string } | { success: true };

// Upsert rather than update -- most school/module pairs have no row yet (absence = enabled, the
// opposite convention from school_feature_flags), so the first toggle for a given school+module
// needs to create the row, not fail trying to update one that was never inserted.
//
// Deliberately does not accept a request to toggle a core module -- the RLS-adjacent guard is
// in school_module_enabled() itself (it ignores is_core rows), but rejecting it here too means
// the UI never even writes a row that would silently do nothing.
export async function setSchoolModule(schoolId: string, moduleId: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: mod, error: modError } = await supabase
    .from("platform_modules")
    .select("is_core, key")
    .eq("id", moduleId)
    .single();
  if (modError) return { error: modError.message };
  if (mod.is_core) return { error: `"${mod.key}" is a core module and can't be disabled.` };

  const { error } = await supabase
    .from("school_modules")
    .upsert(
      { school_id: schoolId, module_id: moduleId, enabled, updated_at: new Date().toISOString(), updated_by: user?.id ?? null },
      { onConflict: "school_id,module_id" },
    );
  if (error) return { error: error.message };
  void logAdminAction(supabase, "set_school_module", { school_id: schoolId, module_id: moduleId, enabled });
  revalidatePath("/admin/modules");
  return { success: true };
}
