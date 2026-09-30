"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { runCurriculumExtraction } from "@/lib/ai/curriculum-extraction";
import { isKicdGrade } from "@/lib/kicd-grade";
import { extractPdfText } from "@/lib/pdf/extract-text";
import { gradeBandLabel } from "@/lib/subject-catalogue-label";

// Import/manage KICD curriculum content. Two kinds of manager (see
// requireKicdManager and migration 20260928140000):
//   - School management (academics.write: school_owner / principal /
//     deputy_principal) import, review/edit, publish, withdraw and discard
//     their OWN school's content. It is private to that school -- different
//     schools follow different curricula, so each school's management owns
//     what its classes are grounded on.
//   - Platform admins keep the platform-wide (school_id null) content and the
//     kill switch: they can see and withdraw any school's content.
// RLS (kicd_can_manage_source) enforces the same boundary in the database, so
// the checks here are friendly early refusals, not the only guard.
//
// This restores the school-management path that #481 added and #477 turned
// off at the app layer. The schema/RLS never went away, so no migration is
// involved. Platform-wide content is untouched.
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

async function requireSuperAdmin() {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false as const, error: "You must be signed in." };
  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) return { supabase, ok: false as const, error: "Only platform admins can manage shared KICD content." };
  return { supabase, ok: true as const };
}

// Who may manage KICD content: platform admins (platform-wide content,
// schoolId = null) and school management -- anyone holding academics.write --
// for THEIR OWN school's content (schoolId = their school).
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

type KicdManager = Extract<Awaited<ReturnType<typeof requireKicdManager>>, { ok: true }>;

// Platform-admin actions go to the platform activity log; school-management
// actions don't (that log is the platform staff's own trail, and its RPC is
// platform-admin only).
function logIfPlatform(auth: KicdManager, action: string, detail: Record<string, unknown>) {
  if (auth.isPlatform) void logAdminAction(auth.supabase, action, detail);
}

function revalidateKicdPages() {
  revalidatePath("/admin/kicd-content");
  revalidatePath("/academics/kicd-content");
}

// A school manager may only act on sources that belong to their own school.
// Returns an error string, or null when allowed. Platform admins always pass.
async function refuseForeignSource(auth: KicdManager, sourceId: string): Promise<string | null> {
  if (auth.isPlatform) return null;
  const { data } = await auth.supabase.from("kicd_content_sources").select("id, school_id").eq("id", sourceId).maybeSingle();
  if (!data) return "Source not found.";
  if (data.school_id !== auth.schoolId) return "You can only manage your own school's KICD content.";
  return null;
}

// School imports are attached to one of the school's own subjects, and that
// subject's catalogue entry is what later matches the content to classes
// (subjects.catalogue_id -> kicd_learning_areas.catalogue_id). Learning areas
// are a global name-unique taxonomy that school roles can only INSERT into, so
// this reuses the area already linked to the catalogue entry, or creates one
// linked at creation. It never edits an existing area. Fails closed with a
// clear message rather than silently importing content that could never apply.
async function resolveSchoolLearningArea(
  supabase: KicdManager["supabase"],
  subjectId: string,
): Promise<{ error: string } | { learningAreaId: string; label: string }> {
  const { data: subject } = await supabase
    .from("subjects")
    .select("id, name, catalogue_id, subject_catalogue(name, grade_band)")
    .eq("id", subjectId)
    .maybeSingle();
  if (!subject) return { error: "Choose one of your school's subjects." };
  const catalogueId = subject.catalogue_id as string | null;
  if (!catalogueId) {
    return { error: "That subject isn't linked to the subject catalogue yet, so its KICD content couldn't be matched to your classes. Contact EduCore support to link it." };
  }
  const cat = (Array.isArray(subject.subject_catalogue) ? subject.subject_catalogue[0] : subject.subject_catalogue) as
    | { name: string; grade_band: string | null }
    | null
    | undefined;
  const label = (cat?.name ?? (subject.name as string)).trim();

  const { data: linked } = await supabase.from("kicd_learning_areas").select("id, name").eq("catalogue_id", catalogueId).order("name").limit(1);
  const existing = (linked ?? [])[0] as { id: string } | undefined;
  if (existing) return { learningAreaId: existing.id, label };

  // Same subject name can exist once per grade band, and area names are unique,
  // so fall back to a band-qualified name if the plain one is already taken.
  const band = gradeBandLabel(cat?.grade_band);
  const candidates = [label, ...(band ? [`${label} — ${band}`] : [])];
  for (const name of candidates) {
    const { data: taken } = await supabase.from("kicd_learning_areas").select("id").eq("name", name).limit(1);
    if ((taken ?? []).length > 0) continue;
    const { data: created, error } = await supabase.from("kicd_learning_areas").insert({ name, catalogue_id: catalogueId }).select("id").single();
    if (created) return { learningAreaId: created.id as string, label };
    if (error?.code === "23505") {
      // Lost a race with another import: use whichever area is now linked.
      const { data: again } = await supabase.from("kicd_learning_areas").select("id").eq("catalogue_id", catalogueId).limit(1);
      const row = (again ?? [])[0] as { id: string } | undefined;
      if (row) return { learningAreaId: row.id, label };
    } else if (error) {
      return { error: error.message };
    }
  }
  return { error: "Couldn't set up a learning area for that subject. Contact EduCore support." };
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
  const subjectId = str("subject_id");
  const grade = str("grade");

  if (!sourceName) return { error: "Give this import a name." };
  if (!licenceReference) return { error: "A licence reference is required for every KICD import." };
  if (!attribution) return { error: "An attribution line is required for every KICD import." };
  if (!isKicdGrade(grade)) return { error: "Please choose a valid grade." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file provided." };
  if (file.type !== "application/pdf") return { error: "Please upload a PDF file." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is larger than the 20MB limit." };

  const auth = await requireKicdManager();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;

  // Platform admins name the learning area; school management pick one of
  // their own subjects (which fixes the learning area and its catalogue link).
  let learningAreaId: string | undefined;
  let extractionLabel = learningAreaName;
  if (auth.isPlatform) {
    if (!learningAreaName) return { error: "Enter the learning area this document covers." };
  } else {
    if (!subjectId) return { error: "Choose the subject this document covers." };
    const resolved = await resolveSchoolLearningArea(supabase, subjectId);
    if ("error" in resolved) return { error: resolved.error };
    learningAreaId = resolved.learningAreaId;
    extractionLabel = resolved.label;
  }

  let documentText: string;
  try {
    documentText = await extractPdfText(await file.arrayBuffer());
  } catch (e) {
    console.error("importKicdDocument: PDF parsing failed:", e);
    return { error: "We couldn't read that PDF. Check it isn't corrupted or password-protected." };
  }
  if (documentText.length < 20) {
    return { error: "No readable text was found in that PDF (it may be a scan). Scanned documents aren't supported yet." };
  }

  const extraction = await runCurriculumExtraction({
    apiKey,
    label: extractionLabel,
    documentText,
    origin: auth.isPlatform ? "platform" : "school",
  });
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

  // Learning area (platform imports): reuse by (case-insensitive) name, else
  // create. School imports already resolved theirs from the chosen subject.
  if (!learningAreaId) {
    const { data: existingArea } = await supabase.from("kicd_learning_areas").select("id").ilike("name", learningAreaName).maybeSingle();
    learningAreaId = existingArea?.id as string | undefined;
  }
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
    learning_area: extractionLabel,
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
  const foreign = await refuseForeignSource(auth, sourceId);
  if (foreign) return { error: foreign };

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
  const foreign = await refuseForeignSource(auth, sourceId);
  if (foreign) return { error: foreign };
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

/**
 * Links a KICD learning area to a platform subject_catalogue entry (or clears
 * the link with null). This link is what lets Scheme of Work match a school's
 * subject (subjects.catalogue_id) to shared content; with no link, that
 * learning area grounds nothing (fail closed). Platform-admin only, same as
 * every other action in this file.
 */
export async function setKicdLearningAreaCatalogue(learningAreaId: string, catalogueId: string | null): Promise<ActionResult> {
  if (typeof learningAreaId !== "string" || !learningAreaId) return { error: "Missing learning area." };
  if (catalogueId !== null && (typeof catalogueId !== "string" || !catalogueId)) return { error: "Invalid subject." };
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { error: "Only platform admins can change learning area mappings." };
  const { supabase } = auth;
  const { data, error } = await supabase.from("kicd_learning_areas").update({ catalogue_id: catalogueId }).eq("id", learningAreaId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Learning area not found." };
  void logAdminAction(supabase, "map_kicd_learning_area", { learning_area_id: learningAreaId, catalogue_id: catalogueId });
  revalidatePath("/admin/kicd-content");
  return { success: true };
}
