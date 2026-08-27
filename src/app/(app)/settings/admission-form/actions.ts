"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface AdmissionFormTemplateInfo {
  original_filename: string;
  uploaded_at: string;
  storage_path: string;
}

export async function getAdmissionFormTemplate(): Promise<AdmissionFormTemplateInfo | null> {
  const supabase = await createClient();
  const { data: schoolId } = await supabase.rpc("auth_school_id");
  if (!schoolId) return null;
  const { data } = await supabase
    .from("admission_form_templates")
    .select("original_filename, uploaded_at, storage_path")
    .eq("school_id", schoolId)
    .maybeSingle();
  return data ?? null;
}

export async function uploadAdmissionFormTemplate(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Please choose a file." };
  if (file.type !== DOCX_MIME) return { error: "Please upload a Word document (.docx)." };

  const { data: schoolId } = await supabase.rpc("auth_school_id");
  if (!schoolId) return { error: "Not signed in." };

  const { data: me } = await supabase.from("school_users").select("id").eq("auth_user_id", (await supabase.auth.getUser()).data.user?.id ?? "").maybeSingle();

  const path = `${schoolId}/template.docx`;

  const { error: uploadError } = await supabase.storage
    .from("admission-form-templates")
    .upload(path, file, { contentType: DOCX_MIME, upsert: true });
  if (uploadError) return { error: uploadError.message };

  const { data: existing } = await supabase
    .from("admission_form_templates")
    .select("id")
    .eq("school_id", schoolId)
    .maybeSingle();

  const { error: dbError } = existing
    ? await supabase
        .from("admission_form_templates")
        .update({ storage_path: path, original_filename: file.name, uploaded_by: me?.id ?? null, uploaded_at: new Date().toISOString() })
        .eq("id", existing.id)
    : await supabase
        .from("admission_form_templates")
        .insert({ school_id: schoolId, storage_path: path, original_filename: file.name, uploaded_by: me?.id ?? null });
  if (dbError) return { error: dbError.message };

  revalidatePath("/settings/admission-form");
  return { success: true };
}

export async function deleteAdmissionFormTemplate(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: schoolId } = await supabase.rpc("auth_school_id");
  if (!schoolId) return { error: "Not signed in." };

  const { data: existing } = await supabase
    .from("admission_form_templates")
    .select("id, storage_path")
    .eq("school_id", schoolId)
    .maybeSingle();
  if (!existing) return { success: true };

  await supabase.storage.from("admission-form-templates").remove([existing.storage_path]);
  const { error } = await supabase.from("admission_form_templates").delete().eq("id", existing.id);
  if (error) return { error: error.message };

  revalidatePath("/settings/admission-form");
  return { success: true };
}
