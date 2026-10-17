"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { validateRequirementLabel } from "@/lib/admission-document-requirements";

export interface DocumentRequirementRow {
  id: string;
  category: string;
  label: string;
  required: boolean;
  display_order: number;
}

type ActionResult = { error: string } | { success: true };

export async function listDocumentRequirements(): Promise<DocumentRequirementRow[]> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data: schoolId } = await supabase.rpc("auth_school_id");
  if (!schoolId) return [];
  const { data } = await supabase
    .from("application_document_requirements")
    .select("id, category, label, required, display_order")
    .eq("school_id", schoolId)
    .order("display_order");
  return (data ?? []) as DocumentRequirementRow[];
}

// RLS on application_document_requirements already limits writes to the caller's own school and
// admissions.write holders; the explicit check just gives a clear message instead of a silent no-op.
async function guard() {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data: allowed } = await supabase.rpc("auth_has_permission", { p_permission_key: "admissions.write" });
  if (allowed !== true) return { supabase, error: "You don't have permission to change admission document requirements." };
  return { supabase, error: null as string | null };
}

export async function updateDocumentRequirement(
  id: string,
  changes: { required?: boolean; label?: string },
): Promise<ActionResult> {
  const { supabase, error } = await guard();
  if (error) return { error };

  const patch: { required?: boolean; label?: string } = {};
  if (typeof changes.required === "boolean") patch.required = changes.required;
  if (changes.label !== undefined) {
    const checked = validateRequirementLabel(changes.label);
    if (!checked.ok) return { error: checked.error };
    patch.label = checked.value;
  }
  if (Object.keys(patch).length === 0) return { success: true };

  const { data, error: updateError } = await supabase
    .from("application_document_requirements")
    .update(patch)
    .eq("id", id)
    .select("id");
  if (updateError) return { error: updateError.message };
  if (!data || data.length === 0) return { error: "Requirement not found." };

  // Affects the wizard checklist, the public application form, and the status page.
  revalidatePath("/settings", "layout");
  revalidatePath("/admissions", "layout");
  return { success: true };
}
