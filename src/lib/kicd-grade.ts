// KICD grade levels a class can be mapped to. The set must match the CHECK
// constraint on classes.kicd_grade / kicd_strands.grade (migration
// 20260928100000). Deliberately an explicit school-confirmed setting rather
// than something inferred from a class's free-text name -- see that
// migration's comment for why.
export const KICD_GRADES = [
  { value: "PP1", label: "PP1" },
  { value: "PP2", label: "PP2" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: `G${i + 1}`, label: `Grade ${i + 1}` })),
] as const;

export type KicdGrade = (typeof KICD_GRADES)[number]["value"];

export function isKicdGrade(value: unknown): value is KicdGrade {
  return typeof value === "string" && KICD_GRADES.some((g) => g.value === value);
}

export function kicdGradeLabel(value: string | null | undefined): string | null {
  return KICD_GRADES.find((g) => g.value === value)?.label ?? null;
}
