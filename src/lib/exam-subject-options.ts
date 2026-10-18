import { catalogueOptionLabel, compareCatalogueOptions } from "@/lib/subject-catalogue-label";

// The New-exam dialog used to list every active subject in the school no matter
// which class was ticked, and showed same-named subjects from different grade
// bands (e.g. "Mathematics" for upper primary AND senior school) as
// indistinguishable duplicates. These helpers scope the list to the selected
// class(es) and de-duplicate it.

export interface ExamPickerSubject {
  id: string;
  name: string;
  /** subject_catalogue.grade_band of the catalogue entry the school activated. */
  grade_band: string | null;
  /** Classes in which this subject is already assigned to a stream (class_subjects). */
  class_ids: string[];
}

export interface ExamPickerClass {
  id: string;
  /** School-confirmed KICD grade (PP1, PP2, G1..G12) or null when not set. */
  kicd_grade: string | null;
}

/** Maps a school-confirmed KICD grade to its subject_catalogue grade band. */
export function gradeToBand(kicdGrade: string | null | undefined): string | null {
  if (!kicdGrade) return null;
  if (kicdGrade === "PP1" || kicdGrade === "PP2") return "pre_primary";
  const m = /^G(\d{1,2})$/.exec(kicdGrade);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 1 && n <= 3) return "lower_primary";
  if (n >= 4 && n <= 6) return "upper_primary";
  if (n >= 7 && n <= 9) return "junior_school";
  if (n >= 10 && n <= 12) return "senior_school";
  return null;
}

/**
 * Does this subject belong to this class? True when it is already assigned in
 * the class, or its grade band matches the class's KICD grade. When the class
 * has no KICD grade set we cannot tell, so every active subject applies (the
 * previous behaviour) rather than hiding subjects the school may need.
 */
export function subjectAppliesToClass(subject: ExamPickerSubject, cls: ExamPickerClass): boolean {
  if (subject.class_ids.includes(cls.id)) return true;
  const band = gradeToBand(cls.kicd_grade);
  return band === null || band === subject.grade_band;
}

/**
 * Subjects to offer for the selected classes: those that apply to at least one
 * of them, with same-named duplicates collapsed. If a name is still ambiguous
 * (e.g. the class has no KICD grade) the grade band is appended to the label.
 * With no class selected, every active subject is returned.
 */
export function subjectsForSelectedClasses(
  subjects: ExamPickerSubject[],
  classes: ExamPickerClass[],
  selectedClassIds: Set<string>,
): { id: string; label: string }[] {
  const selected = classes.filter((c) => selectedClassIds.has(c.id));
  const visible =
    selected.length === 0 ? subjects : subjects.filter((s) => selected.some((c) => subjectAppliesToClass(s, c)));

  const byName = new Map<string, ExamPickerSubject[]>();
  for (const s of visible) byName.set(s.name, [...(byName.get(s.name) ?? []), s]);

  const kept: ExamPickerSubject[] = [];
  for (const group of byName.values()) {
    if (group.length > 1) {
      // Prefer the copy actually assigned in a selected class.
      const assigned = group.filter((s) => selected.some((c) => s.class_ids.includes(c.id)));
      if (assigned.length > 0) {
        kept.push(...assigned);
        continue;
      }
    }
    kept.push(...group);
  }

  const counts = new Map<string, number>();
  for (const s of kept) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);

  return kept
    .sort(compareCatalogueOptions)
    .map((s) => ({ id: s.id, label: (counts.get(s.name) ?? 0) > 1 ? catalogueOptionLabel(s.name, s.grade_band) : s.name }));
}
