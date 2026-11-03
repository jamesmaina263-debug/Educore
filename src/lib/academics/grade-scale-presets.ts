// Phase 7.6: letter and number grade scales as DATA.
//
// These are presets that fill the existing "New grading scale" form (numeric model: label / min / max / points).
// No schema change: grading_scales + grading_scale_bands already hold them, and the database matches a mark with
// `raw_score >= min_score and raw_score <= max_score` on numeric(5,2). So every preset below is gap-free: the upper
// bound of each band is 0.01 under the lower bound of the band above it, otherwise a mark such as 74.5 would match
// no band at all.
//
// INDICATIVE ONLY. Exam boards set real grade boundaries per paper and per series, and they change. These
// percentage boundaries are a starting point the school edits before use; nothing here is licensed board content.

export interface PresetBand {
  label: string;
  min_score: string;
  max_score: string;
  points: string;
}

export interface GradeScalePreset {
  id: "igcse-a-star-g" | "gcse-9-1";
  name: string;
  /** Shown next to the button so nobody mistakes an indicative preset for an official scale. */
  description: string;
  bands: PresetBand[];
}

/** Builds contiguous bands from [label, lower bound, points] rows given highest first. The top band ends at 100. */
function contiguous(rows: [label: string, min: number, points: number][]): PresetBand[] {
  return rows.map(([label, min, points], i) => {
    const max = i === 0 ? 100 : Math.round((rows[i - 1][1] - 0.01) * 100) / 100;
    return { label, min_score: String(min), max_score: String(max), points: String(points) };
  });
}

export const GRADE_SCALE_PRESETS: GradeScalePreset[] = [
  {
    id: "igcse-a-star-g",
    name: "IGCSE-style A*-G Scale",
    description: "A*, A to G and U. Indicative percentage bands; confirm against your exam board's grade boundaries.",
    bands: contiguous([
      ["A*", 90, 8],
      ["A", 80, 7],
      ["B", 70, 6],
      ["C", 60, 5],
      ["D", 50, 4],
      ["E", 40, 3],
      ["F", 30, 2],
      ["G", 20, 1],
      ["U", 0, 0],
    ]),
  },
  {
    id: "gcse-9-1",
    name: "9-1 Grade Scale",
    description: "Grades 9 (highest) to 1 and U. Indicative percentage bands; confirm against your exam board's grade boundaries.",
    bands: contiguous([
      ["9", 90, 9],
      ["8", 80, 8],
      ["7", 70, 7],
      ["6", 60, 6],
      ["5", 50, 5],
      ["4", 40, 4],
      ["3", 30, 3],
      ["2", 20, 2],
      ["1", 10, 1],
      ["U", 0, 0],
    ]),
  },
];

export type BandCheckIssue =
  | { kind: "gap"; from: number; to: number }
  | { kind: "overlap"; between: [string, string] }
  | { kind: "inverted"; label: string }
  | { kind: "no_zero" }
  | { kind: "no_hundred" };

/**
 * Checks a numeric scale for the problems that leave a mark with no grade or two grades: bands where min > max,
 * overlapping bands, gaps wider than one hundredth between bands, and no band reaching 0 or 100.
 * Blank/non-numeric bands are ignored (the form already requires min and max). Pure; advisory only.
 */
export function checkBands(bands: { label: string; min_score: string; max_score: string }[]): BandCheckIssue[] {
  const rows = bands
    .map((b) => ({ label: b.label.trim(), min: b.min_score.trim() === "" ? NaN : Number(b.min_score), max: b.max_score.trim() === "" ? NaN : Number(b.max_score) }))
    .filter((b) => b.label !== "" && Number.isFinite(b.min) && Number.isFinite(b.max));
  if (rows.length === 0) return [];
  const issues: BandCheckIssue[] = [];
  for (const r of rows) if (r.min > r.max) issues.push({ kind: "inverted", label: r.label });
  const ok = rows.filter((r) => r.min <= r.max).sort((a, b) => a.min - b.min);
  if (ok.length === 0) return issues;
  if (ok[0].min > 0) issues.push({ kind: "no_zero" });
  if (Math.max(...ok.map((r) => r.max)) < 100) issues.push({ kind: "no_hundred" });
  const cents = (n: number) => Math.round(n * 100);
  for (let i = 1; i < ok.length; i++) {
    const prev = ok[i - 1];
    const cur = ok[i];
    if (cents(cur.min) <= cents(prev.max)) issues.push({ kind: "overlap", between: [prev.label, cur.label] });
    else if (cents(cur.min) - cents(prev.max) > 1) issues.push({ kind: "gap", from: prev.max, to: cur.min });
  }
  return issues;
}

export function describeIssue(issue: BandCheckIssue): string {
  switch (issue.kind) {
    case "gap":
      return `Marks between ${issue.from} and ${issue.to} (for example ${((issue.from + issue.to) / 2).toFixed(2)}) would get no grade.`;
    case "overlap":
      return `Bands ${issue.between[0]} and ${issue.between[1]} overlap, so a mark could match both.`;
    case "inverted":
      return `Band ${issue.label} has a minimum higher than its maximum.`;
    case "no_zero":
      return "No band starts at 0, so very low marks would get no grade.";
    case "no_hundred":
      return "No band reaches 100, so the top marks would get no grade.";
  }
}
