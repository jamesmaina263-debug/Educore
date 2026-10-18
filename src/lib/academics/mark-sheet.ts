// Pure builder for the class mark sheet export (Excel / CSV / PDF). Split out of the
// Report Cards page so the cell rules are unit tested.
//
// Cell rule: a numeric exam shows the raw score; a band-graded (CBC) exam has no raw
// score, so it shows the band label instead; no mark at all shows an em dash. Before this,
// band-graded exams exported as a table of blank cells.

export interface MarkSheetStudent {
  full_name: string;
  marks: { subject_name: string; raw_score: number | null; band_label: string | null }[];
  average_score: number | null;
  rank_in_stream: number | null;
}

export function buildMarkSheetRows(students: MarkSheetStudent[]): Record<string, string | number>[] {
  // Union of subjects across the class, alphabetical, so every row has the same columns.
  const subjectNames = Array.from(new Set(students.flatMap((s) => s.marks.map((m) => m.subject_name)))).sort();
  return students.map((s) => {
    const markBySubject = new Map(s.marks.map((m) => [m.subject_name, m]));
    const row: Record<string, string | number> = { Student: s.full_name };
    for (const subject of subjectNames) {
      const m = markBySubject.get(subject);
      row[subject] = m?.raw_score ?? m?.band_label ?? "—";
    }
    row["Average"] = s.average_score ?? "—";
    row["Rank"] = s.rank_in_stream ?? "—";
    return row;
  });
}
