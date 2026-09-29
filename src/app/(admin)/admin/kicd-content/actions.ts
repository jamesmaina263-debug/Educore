"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { runCurriculumExtraction } from "@/lib/ai/curriculum-extraction";
import { isKicdGrade } from "@/lib/kicd-grade";

// Import/manage KICD curriculum content: platform-wide (platform admins) or private to one
// school (that school's management) -- see requireKicdManager and migration 20260928140000.
// Phase 2B, PR 2 of 3 -- nothing reads the shared tables for grounding yet
// (PR 3), so importing/publishing has no effect on any school until then.
//
// Review-before-publish without a new flag: every import creates its source
// with is_enabled = false. Shared rows are only visible to schools while their
// source is enabled (kicd_*_select RLS), so an imported batch is invisible
// until an admin has reviewed/edited it and explicitly enables the source --
// and the same switch is the kill switch afterwards. Licence details are
// entered by the admin per batch (never defaulted or inferred): the schema
// requires licence_reference and attribution, and this action refuses without
// them.

type ActionResult = { error: string } | { success: true };
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Who may manage KICD content: platform admins (platform-wide content, schoolId = null) and
// school management -- anyone holding academics.write (school_owner / principal /
// deputy_principal) -- for THEIR OWN school's content (schoolId = their school). RLS
// (kicd_can_manage_source) enforces the same boundary in the database, so this check is a
// friendly early refusal, not the only guard.
async function requireKicdManager() {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false as const, error: "You must be signed in." };
  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin === true) return { supabase, ok: true as const, isPlatform: true as const, schoolId: null, schoolUserId: null };
  const { data: canManage } = await supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" });
  if (canManage !== true) return { supabase, ok: false as const, error: "You don't have permission to manage KICD content." };
  const { data: schoolUser } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user.id).maybeSingle();
  if (!schoolUser?.school_id) return { supabase, ok: false as const, error: "Your account isn't attached to a school." };
  return {
    supabase,
    ok: true as const,
    isPlatform: false as const,
    schoolId: schoolUser.school_id as string,
    schoolUserId: schoolUser.id as string,
  };
}

// Platform admin actions go to the platform activity log; school-management actions don't
// (that log is the platform staff's own trail, and its RPC is platform-admin only).
function logIfPlatform(auth: { isPlatform: boolean; supabase: Parameters<typeof logAdminAction>[0] }, action: string, detail: Record<string, unknown>) {
  if (auth.isPlatform) void logAdminAction(auth.supabase, action, detail);
}

function revalidateKicdPages() {
  revalidatePath("/admin/kicd-content");
  revalidatePath("/academics/kicd-content");
}

export type ImportKicdResult =
  | { error: string }
  | { success: true; sourceId: string; strands: number; subStrands: number; truncated: boolean };

export async function importKicdDocument(formData: FormData): Promise<ImportKicdResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: "AI extraction isn't configured — GEMINI_API_KEY is missing from the server environment." };

  const str = (k: string) => (typeof formData.get(k) === "string" ? (formData.get(k) as string).trim() : "");
  const sourceName = str("source_name");
  const licenceReference = str("licence_reference");
  const licenceScope = str("licence_scope");
  const attribution = str("attribution");
  const learningAreaName = str("learning_area");
  const grade = str("grade");

  if (!sourceName) return { error: "Give this import a name." };
  if (!licenceReference) return { error: "A licence reference is required for every KICD import." };
  if (!attribution) return { error: "An attribution line is required for every KICD import." };
  if (!learningAreaName) return { error: "Enter the learning area this document covers." };
  if (!isKicdGrade(grade)) return { error: "Please choose a valid grade." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file provided." };
  if (file.type !== "application/pdf") return { error: "Please upload a PDF file." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is larger than the 20MB limit." };

  const auth = await requireKicdManager();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;

  let documentText: string;
  try {
    const pdfParse = (await import("pdf-parse")).default;
    documentText = (await pdfParse(Buffer.from(await file.arrayBuffer()))).text?.trim() ?? "";
  } catch (e) {
    console.error("importKicdDocument: PDF parsing failed:", e);
    return { error: "We couldn't read that PDF. Check it isn't corrupted or password-protected." };
  }
  if (documentText.length < 20) {
    return { error: "No readable text was found in that PDF (it may be a scan). Scanned documents aren't supported yet." };
  }

  const extraction = await runCurriculumExtraction({ apiKey, label: learningAreaName, documentText, origin: "platform" });
  if ("error" in extraction) return { error: extraction.error };

  // Merge repeated strand / sub-strand names within this document (the tables
  // are unique on them) instead of failing the whole import on a duplicate.
  const strandMap = new Map<string, { name: string; subs: Map<string, (typeof extraction.result.strands)[number]["sub_strands"][number]> }>();
  for (const strand of extraction.result.strands) {
    const key = strand.name.trim().toLowerCase();
    const entry = strandMap.get(key) ?? { name: strand.name, subs: new Map() };
    for (const sub of strand.sub_strands) {
      const subKey = sub.name.trim().toLowerCase();
      if (!entry.subs.has(subKey)) entry.subs.set(subKey, sub);
    }
    strandMap.set(key, entry);
  }
  const strands = [...strandMap.values()];

  // Learning area: reuse by (case-insensitive) name, else create.
  const { data: existingArea } = await supabase.from("kicd_learning_areas").select("id").ilike("name", learningAreaName).maybeSingle();
  let learningAreaId = existingArea?.id as string | undefined;
  if (!learningAreaId) {
    const { data: newArea, error: areaError } = await supabase.from("kicd_learning_areas").insert({ name: learningAreaName }).select("id").single();
    if (areaError || !newArea) return { error: areaError?.message ?? "Could not create the learning area." };
    learningAreaId = newArea.id as string;
  }

  const { data: source, error: sourceError } = await supabase
    .from("kicd_content_sources")
    .insert({
      name: sourceName,
      licence_reference: licenceReference,
      licence_scope: licenceScope || null,
      attribution,
      source_document: file.name,
      is_enabled: false, // unpublished until reviewed -- see header comment
      school_id: auth.schoolId, // null = platform-wide; set = private to that school
      created_by: auth.schoolUserId,
    })
    .select("id")
    .single();
  if (sourceError || !source) return { error: sourceError?.message ?? "Could not record the import." };
  const sourceId = source.id as string;

  const rollback = async () => {
    await supabase.from("kicd_strands").delete().eq("source_id", sourceId); // sub-strands cascade
    await supabase.from("kicd_content_sources").delete().eq("id", sourceId);
  };

  const { data: insertedStrands, error: strandError } = await supabase
    .from("kicd_strands")
    .insert(strands.map((s, i) => ({ source_id: sourceId, learning_area_id: learningAreaId, grade, name: s.name, level_order: i })))
    .select("id, name");
  if (strandError || !insertedStrands) {
    await rollback();
    return { error: strandError?.message ?? "Could not save the extracted strands. Nothing was kept." };
  }

  const idByName = new Map(insertedStrands.map((r) => [(r.name as string).trim().toLowerCase(), r.id as string]));
  const subRows = strands.flatMap((s) =>
    [...s.subs.values()].map((sub, i) => ({
      strand_id: idByName.get(s.name.trim().toLowerCase()),
      name: sub.name,
      level_order: i,
      learning_outcomes: sub.learning_outcomes || null,
      key_inquiry_questions: sub.key_inquiry_questions || null,
      rubric_text: sub.rubric_text || null,
    })),
  );
  const { error: subError } = await supabase.from("kicd_sub_strands").insert(subRows);
  if (subError) {
    await rollback();
    return { error: subError.message };
  }

  logIfPlatform(auth, "import_kicd_document", {
    source_id: sourceId,
    source_name: sourceName,
    licence_reference: licenceReference,
    learning_area: learningAreaName,
    grade,
    strands: strands.length,
    sub_strands: subRows.length,
  });
  revalidateKicdPages();
  return { success: true, sourceId, strands: strands.length, subStrands: subRows.length, truncated: extraction.truncated };
}

export async function setKicdSourceEnabled(sourceId: string, enabled: boolean): Promise<ActionResult> {
  if (typeof sourceId !== "string" || !sourceId) return { error: "Missing source." };
  const auth = await requireKicdManager();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;

  if (enabled) {
    const { data: strandRows } = await supabase.from("kicd_strands").select("id").eq("source_id", sourceId).limit(1);
    if (!strandRows || strandRows.length === 0) return { error: "This source has no content to publish." };
  }
  const { data, error } = await supabase.from("kicd_content_sources").update({ is_enabled: enabled }).eq("id", sourceId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Source not found." };
  logIfPlatform(auth, enabled ? "publish_kicd_source" : "withdraw_kicd_source", { source_id: sourceId });
  revalidateKicdPages();
  return { success: true };
}

export async function updateKicdSubStrand(
  subStrandId: string,
  fields: { name: string; learning_outcomes: string; key_inquiry_questions: string; rubric_text: string },
): Promise<ActionResult> {
  if (typeof subStrandId !== "string" || !subStrandId) return { error: "Missing sub-strand." };
  const name = fields.name?.trim();
  if (!name) return { error: "Name is required." };
  const auth = await requireKicdManager();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;
  const { data, error } = await supabase
    .from("kicd_sub_strands")
    .update({
      name,
      learning_outcomes: fields.learning_outcomes?.trim() || null,
      key_inquiry_questions: fields.key_inquiry_questions?.trim() || null,
      rubric_text: fields.rubric_text?.trim() || null,
    })
    .eq("id", subStrandId)
    .select("id");
  if (error) return { error: error.code === "23505" ? "Another sub-strand in this strand already has that name." : error.message };
  if (!data || data.length === 0) return { error: "Sub-strand not found." };
  logIfPlatform(auth, "edit_kicd_sub_strand", { sub_strand_id: subStrandId });
  revalidateKicdPages();
  return { success: true };
}

export async function deleteKicdSubStrand(subStrandId: string): Promise<ActionResult> {
  if (typeof subStrandId !== "string" || !subStrandId) return { error: "Missing sub-strand." };
  const auth = await requireKicdManager();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;
  const { data, error } = await supabase.from("kicd_sub_strands").delete().eq("id", subStrandId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Sub-strand not found." };
  logIfPlatform(auth, "delete_kicd_sub_strand", { sub_strand_id: subStrandId });
  revalidateKicdPages();
  return { success: true };
}

/** Discards an import entirely. Refused while published: withdraw it first so
 *  content is never deleted out from under schools by a single click. */
export async function deleteKicdSource(sourceId: string): Promise<ActionResult> {
  if (typeof sourceId !== "string" || !sourceId) return { error: "Missing source." };
  const auth = await requireKicdManager();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;
  const { data: source } = await supabase.from("kicd_content_sources").select("id, is_enabled").eq("id", sourceId).maybeSingle();
  if (!source) return { error: "Source not found." };
  if (source.is_enabled) return { error: "Withdraw this source before deleting it." };
  await supabase.from("kicd_strands").delete().eq("source_id", sourceId);
  const { error } = await supabase.from("kicd_content_sources").delete().eq("id", sourceId);
  if (error) return { error: error.message };
  logIfPlatform(auth, "delete_kicd_source", { source_id: sourceId });
  revalidateKicdPages();
  return { success: true };
}
