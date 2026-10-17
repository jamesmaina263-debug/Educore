"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import {
  MAX_REQUIREMENTS_PER_SCHOOL,
  isCustomCategory,
  makeCustomCategory,
  validateRequirementLabel,
} from "@/lib/admission-document-requirements";

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

export async function addDocumentRequirement(label: string, required: boolean): Promise<ActionResult> {
  const { supabase, error } = await guard();
  if (error) return { error };
  const checked = validateRequirementLabel(label);
  if (!checked.ok) return { error: checked.error };

  const { data: schoolId } = await supabase.rpc("auth_school_id");
  if (!schoolId) return { error: "Could not resolve your school." };

  const { data: existing } = await supabase
    .from("application_document_requirements")
    .select("label, display_order")
    .eq("school_id", schoolId);
  const rows = existing ?? [];
  if (rows.length >= MAX_REQUIREMENTS_PER_SCHOOL) {
    return { error: `You can have at most ${MAX_REQUIREMENTS_PER_SCHOOL} admission documents.` };
  }
  if (rows.some((r) => r.label.toLowerCase() === checked.value.toLowerCase())) {
    return { error: `"${checked.value}" is already on your list.` };
  }

  const { error: insertError } = await supabase.from("application_document_requirements").insert({
    school_id: schoolId,
    category: makeCustomCategory(checked.value),
    label: checked.value,
    required,
    display_order: rows.reduce((max, r) => Math.max(max, r.display_order), 0) + 1,
  });
  if (insertError) return { error: insertError.message };

  revalidatePath("/settings", "layout");
  revalidatePath("/admissions", "layout");
  return { success: true };
}

// Only school-defined documents can be removed. Already-uploaded files are not deleted; they simply
// stop being part of the checklist. The built-in documents can only be switched to optional.
export async function deleteDocumentRequirement(id: string): Promise<ActionResult> {
  const { supabase, error } = await guard();
  if (error) return { error };

  const { data: row } = await supabase
    .from("application_document_requirements")
    .select("id, category")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Requirement not found." };
  if (!isCustomCategory(row.category)) {
    return { error: "Built-in documents can't be removed. Untick Required to make it optional." };
  }

  const { error: deleteError } = await supabase.from("application_document_requirements").delete().eq("id", id);
  if (deleteError) return { error: deleteError.message };

  revalidatePath("/settings", "layout");
  revalidatePath("/admissions", "layout");
  return { success: true };
}
