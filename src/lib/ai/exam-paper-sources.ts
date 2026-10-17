import type { SupabaseClient } from "@supabase/supabase-js";
import { isKicdGrade } from "@/lib/kicd-grade";
import type { ExamSourceOption, ExamSubStrandCandidate } from "@/lib/ai/exam-paper";

// READ-ONLY loader of the curriculum sources an exam paper can be generated
// from, for one class + subject. It reuses the same links the existing
// grounding uses (classes.kicd_grade, subjects.catalogue_id ->
// kicd_learning_areas, curriculum_strands by subject) but, unlike
// scheme-of-work grounding, it NEVER merges sources: each KICD source and the
// school's own curriculum come back as separate options, each with its own
// attribution, and the teacher must pick exactly one. It performs no writes
// and does not touch fetchSharedKicdStrands / mergeCurriculumStrands.

export interface ExamSourceLoadResult {
  options: ExamSourceOption[];
  /** Plain-language reasons a source family is unavailable (fail-closed links). */
  notes: string[];
}

interface SubRow {
  id: string;
  name: string;
  level_order?: number | null;
  learning_outcomes: string | null;
  key_inquiry_questions: string | null;
  rubric_text: string | null;
  content_source?: string | null;
  content_updated_at?: string | null;
}

const byOrderThenName = (a: SubRow, b: SubRow) => (a.level_order ?? 0) - (b.level_order ?? 0) || a.name.localeCompare(b.name);

export async function loadExamSourceOptions(
  supabase: SupabaseClient,
  ids: { classId: string; subjectId: string; schoolId: string },
): Promise<ExamSourceLoadResult | null> {
  const [{ data: cls }, { data: subject }] = await Promise.all([
    supabase.from("classes").select("kicd_grade, school_id").eq("id", ids.classId).eq("school_id", ids.schoolId).maybeSingle(),
    supabase.from("subjects").select("catalogue_id, school_id").eq("id", ids.subjectId).eq("school_id", ids.schoolId).maybeSingle(),
  ]);
  if (!cls || !subject) return null;

  const options: ExamSourceOption[] = [];
  const notes: string[] = [];

  // ---- The school's own curriculum (curriculum_strands), by subject. ----
  const { data: ownStrands } = await supabase
    .from("curriculum_strands")
    .select("name, level_order, curriculum_sub_strands(id, name, level_order, learning_outcomes, key_inquiry_questions, rubric_text, content_source, content_updated_at)")
    .eq("subject_id", ids.subjectId)
    .eq("school_id", ids.schoolId)
    .order("level_order");
  const ownCandidates: ExamSubStrandCandidate[] = [];
  for (const s of (ownStrands ?? []) as { name: string; curriculum_sub_strands: SubRow[] | null }[]) {
    for (const ss of [...(s.curriculum_sub_strands ?? [])].sort(byOrderThenName)) {
      ownCandidates.push({
        ref: ss.id,
        strand: s.name,
        name: ss.name,
        learning_outcomes: ss.learning_outcomes,
        key_inquiry_questions: ss.key_inquiry_questions,
        rubric_text: ss.rubric_text,
        content_source: ss.content_source ?? "school_authored",
        content_updated_at: ss.content_updated_at ?? null,
      });
    }
  }
  if (ownCandidates.length > 0) {
    options.push({ kind: "school_authored", sourceId: null, name: "School's own curriculum", licenceReference: null, attribution: null, subStrands: ownCandidates });
  } else {
    notes.push("This school has no curriculum content recorded for this subject yet.");
  }

  // ---- KICD sources (platform-wide and this school's own imports), each kept separate. ----
  const grade = (cls as { kicd_grade?: unknown }).kicd_grade;
  const catalogueId = (subject as { catalogue_id?: unknown }).catalogue_id;
  if (!isKicdGrade(grade)) {
    notes.push("KICD content is unavailable: this class has no KICD grade set (set it under Academics > Classes).");
    return { options, notes };
  }
  if (typeof catalogueId !== "string" || !catalogueId) {
    notes.push("KICD content is unavailable: this subject is not linked to a KICD learning area.");
    return { options, notes };
  }
  const { data: areas } = await supabase.from("kicd_learning_areas").select("id").eq("catalogue_id", catalogueId);
  const areaIds = ((areas ?? []) as { id: string }[]).map((a) => a.id);
  if (areaIds.length === 0) {
    notes.push("KICD content is unavailable: this subject is not mapped to a KICD learning area.");
    return { options, notes };
  }

  // Published sources only (is_enabled), and only platform-wide or THIS school's.
  const { data: kicdRows } = await supabase
    .from("kicd_strands")
    .select(
      "name, level_order, kicd_content_sources!inner(id, name, licence_reference, attribution, is_enabled, school_id), kicd_sub_strands(id, name, level_order, learning_outcomes, key_inquiry_questions, rubric_text)",
    )
    .in("learning_area_id", areaIds)
    .eq("grade", grade)
    .eq("kicd_content_sources.is_enabled", true)
    .or(`school_id.is.null,school_id.eq.${ids.schoolId}`, { referencedTable: "kicd_content_sources" })
    .order("level_order");

  type Src = { id: string; name: string; licence_reference: string; attribution: string; is_enabled: boolean; school_id: string | null };
  type KRow = { name: string; kicd_content_sources: Src | Src[] | null; kicd_sub_strands: SubRow[] | null };
  const grouped = new Map<string, { src: Src; subs: ExamSubStrandCandidate[] }>();
  for (const row of (kicdRows ?? []) as KRow[]) {
    const src = Array.isArray(row.kicd_content_sources) ? row.kicd_content_sources[0] : row.kicd_content_sources;
    if (!src || !src.is_enabled) continue;
    if (src.school_id !== null && src.school_id !== ids.schoolId) continue; // defence in depth: never another school's
    const entry = grouped.get(src.id) ?? { src, subs: [] };
    for (const ss of [...(row.kicd_sub_strands ?? [])].sort(byOrderThenName)) {
      entry.subs.push({
        ref: ss.id,
        strand: row.name,
        name: ss.name,
        learning_outcomes: ss.learning_outcomes,
        key_inquiry_questions: ss.key_inquiry_questions,
        rubric_text: ss.rubric_text,
        content_source: "kicd_licensed",
        content_updated_at: null, // kicd_sub_strands carries no update timestamp
      });
    }
    grouped.set(src.id, entry);
  }
  for (const { src, subs } of grouped.values()) {
    if (subs.length === 0) continue;
    options.push({
      kind: src.school_id === null ? "platform_kicd" : "school_kicd",
      sourceId: src.id,
      name: src.name,
      licenceReference: src.licence_reference,
      attribution: src.attribution,
      subStrands: subs,
    });
  }
  if (grouped.size === 0) notes.push("No published KICD content exists for this class's grade and subject.");
  return { options, notes };
}
