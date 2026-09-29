import type { SupabaseClient } from "@supabase/supabase-js";
import { isKicdGrade } from "@/lib/kicd-grade";
import type { CurriculumStrandRow, CurriculumSubStrandRow } from "@/lib/ai/scheme-of-work";

// Phase 2B, PR 3 of 3: feed shared (EduCore-wide) KICD content into Scheme of
// Work grounding alongside a school's own recorded content.
//
// Which shared content applies to a scheme is decided by an explicit chain,
// never by name guessing:
//   class.kicd_grade  (school-confirmed, PR 1)
//   subject.catalogue_id -> kicd_learning_areas.catalogue_id  (platform-admin mapping)
//   -> kicd_strands for that learning area + grade, from PUBLISHED sources only.
// Any missing link means no shared content (fail closed).

const KICD_SOURCE = "kicd_licensed";

function hasContent(ss: CurriculumSubStrandRow): boolean {
  return Boolean(ss.learning_outcomes?.trim() || ss.key_inquiry_questions?.trim() || ss.rubric_text?.trim());
}

/**
 * Combines shared KICD strands with a school's own. Rules:
 *  - Only the school's USABLE rows (not 'draft', with some content) count.
 *    A draft or empty school row never overrides KICD content -- it is
 *    simply ignored, exactly as buildCurriculumContext already ignores it.
 *  - On a name conflict (same strand, same sub-strand; case/space-insensitive)
 *    the school's row wins -- the school's own reviewed content is
 *    authoritative for that school.
 *  - Everything else from both sides is kept. KICD order first, then
 *    strands only the school has.
 */
export function mergeCurriculumStrands(schoolStrands: CurriculumStrandRow[], kicdStrands: CurriculumStrandRow[]): CurriculumStrandRow[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const usableSchool = schoolStrands
    .map((s) => ({ name: s.name, sub_strands: s.sub_strands.filter((ss) => ss.content_source !== "draft" && hasContent(ss)) }))
    .filter((s) => s.sub_strands.length > 0);

  const schoolByName = new Map(usableSchool.map((s) => [norm(s.name), s]));
  const merged: CurriculumStrandRow[] = [];
  const used = new Set<string>();

  for (const k of kicdStrands) {
    const key = norm(k.name);
    const school = schoolByName.get(key);
    if (!school) {
      merged.push(k);
      continue;
    }
    used.add(key);
    const schoolSubNames = new Set(school.sub_strands.map((ss) => norm(ss.name)));
    merged.push({
      name: school.name,
      sub_strands: [...school.sub_strands, ...k.sub_strands.filter((ss) => !schoolSubNames.has(norm(ss.name)))],
    });
  }
  for (const s of usableSchool) {
    if (!used.has(norm(s.name))) merged.push(s);
  }
  return merged;
}

/**
 * Loads published shared KICD strands for a class + subject. Never throws and
 * never blocks generation: on any error or missing link it returns [] and the
 * caller proceeds with the school's own content alone.
 */
export async function fetchSharedKicdStrands(
  supabase: SupabaseClient,
  ids: { classId?: string | null; subjectId?: string | null },
): Promise<CurriculumStrandRow[]> {
  try {
    if (!ids.classId || !ids.subjectId) return [];

    const [{ data: cls }, { data: subject }] = await Promise.all([
      supabase.from("classes").select("kicd_grade").eq("id", ids.classId).maybeSingle(),
      supabase.from("subjects").select("catalogue_id").eq("id", ids.subjectId).maybeSingle(),
    ]);
    const grade = (cls as { kicd_grade?: unknown } | null)?.kicd_grade;
    const catalogueId = (subject as { catalogue_id?: unknown } | null)?.catalogue_id;
    if (!isKicdGrade(grade) || typeof catalogueId !== "string" || !catalogueId) return [];

    const { data: areas } = await supabase.from("kicd_learning_areas").select("id").eq("catalogue_id", catalogueId);
    const areaIds = ((areas ?? []) as { id: string }[]).map((a) => a.id);
    if (areaIds.length === 0) return [];

    // !inner + explicit filters: published, PLATFORM-WIDE sources only.
    // is_enabled: real even for a session whose RLS would otherwise also
    // expose unpublished ones (a platform admin, or this school's own
    // academics.write holder managing their own sources).
    // school_id is null: schools can now also import their OWN private KICD
    // content (kicd_content_sources.school_id set -- a separate feature, not
    // part of this design). Deliberately excluded from grounding here: this
    // PR only wires in officially-published EduCore/KICD content, exactly as
    // approved. Folding a school's own private KICD imports into grounding
    // too is a real product question (there would then be two separate
    // "upload your own content" paths both feeding generation) that needs a
    // decision, not a default.
    const { data: strands } = await supabase
      .from("kicd_strands")
      .select("name, level_order, kicd_content_sources!inner(is_enabled, school_id), kicd_sub_strands(name, learning_outcomes, key_inquiry_questions, rubric_text)")
      .in("learning_area_id", areaIds)
      .eq("grade", grade)
      .eq("kicd_content_sources.is_enabled", true)
      .is("kicd_content_sources.school_id", null)
      .order("level_order");

    return ((strands ?? []) as unknown as { name: string; kicd_sub_strands: Omit<CurriculumSubStrandRow, "content_source">[] | null }[]).map((s) => ({
      name: s.name,
      sub_strands: (s.kicd_sub_strands ?? []).map((ss) => ({ ...ss, content_source: KICD_SOURCE })),
    }));
  } catch (e) {
    console.error("fetchSharedKicdStrands: falling back to school content only:", e);
    return [];
  }
}
