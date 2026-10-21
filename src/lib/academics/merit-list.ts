import { MISSING, round, type MarkSheetLearner, type MarkSheetModel } from "@/lib/academics/mark-sheet-model";

// Pure builder for the Examination Results / Merit List, derived from the SAME MarkSheetModel the
// class mark sheet uses (loaded RLS-scoped by load-mark-sheet.ts). No new queries, no new
// calculations: positions are the stored class_rankings positions (rank() over the percentage
// average), so the merit list and the mark sheet can never disagree, and all the rules documented in
// mark-sheet-model.ts (missing is never zero, incomplete learners flagged, CBC has no ranking) carry
// over unchanged.
//
// Additional rules specific to the merit list:
//  * Only marks-based ("numeric") assessments get a merit list. Competency-based (CBC) and mixed
//    assessments are reported by performance level, so no list is offered rather than inventing ranks.
//  * Overall POSITION is the learner's position in the class (and in the stream when there are several).
//    SUBJECT performance is a separate section (highest/lowest with who achieved them), never mixed
//    into the position column.
//  * Ties share a position (1, 1, 3), exactly as stored.
//  * If the school turned ranking off (report settings), the list is titled "Examination Results", has
//    no position column and keeps the original (surname) order: the same data without ranking.
//  * Learners with no numeric result are listed last as "No result" and are never ranked.

export type MeritEligibility = { available: true } | { available: false; reason: string };

export function meritListEligibility(model: MarkSheetModel): MeritEligibility {
  if (model.kind === "numeric") return { available: true };
  if (model.kind === "cbc") return { available: false, reason: "This is a competency-based assessment. It is reported by performance level, so no merit list or ranking applies." };
  if (model.kind === "mixed") return { available: false, reason: "This assessment mixes marks and competency levels, which cannot be ranked together." };
  return { available: false, reason: "No marks have been entered for this assessment yet." };
}

export interface MeritRow {
  /** Position in the class; null when positions are off or the learner has no result. */
  position: number | null;
  /** Position in the stream, only when the class has several streams. */
  streamPosition: number | null;
  learner: MarkSheetLearner;
  hasResult: boolean;
}

export interface SubjectSummary {
  subjectId: string;
  name: string;
  maxScore: number;
  entered: number;
  mean: number | null;
  /** Mean as a percentage of the subject's maximum. */
  meanPercent: number | null;
  highest: number | null;
  highestBy: string[];
  lowest: number | null;
  lowestBy: string[];
}

export interface MeritList {
  title: "MERIT LIST" | "EXAMINATION RESULTS";
  positioned: boolean;
  rows: MeritRow[];
  subjectSummary: SubjectSummary[];
  tiesPresent: boolean;
  noResultCount: number;
  /** Learners who have a result but fewer subjects entered than examined (the ones marked *). Excludes no-result learners. */
  incompleteCount: number;
}

function who(model: MarkSheetModel, subjectId: string, score: number | null): string[] {
  if (score === null) return [];
  return model.learners.filter((l) => l.cells[subjectId]?.score === score).map((l) => l.name);
}

/** Mean as a percentage of the maximum, from the raw scores (the subject mean on the model is already rounded). */
function meanPercent(model: MarkSheetModel, subjectId: string, maxScore: number): number | null {
  const scores = model.learners.map((l) => l.cells[subjectId]?.score).filter((v): v is number => typeof v === "number");
  if (scores.length === 0 || maxScore <= 0) return null;
  return round(((scores.reduce((a, b) => a + b, 0) / scores.length) / maxScore) * 100, 1);
}

export function buildMeritList(model: MarkSheetModel): MeritList {
  const positioned = model.showPositions;
  const hasResult = (l: MarkSheetLearner) => l.average !== null;

  let ordered: MarkSheetLearner[];
  if (positioned) {
    const ranked = model.learners.filter(hasResult).sort((a, b) => (a.rankInClass ?? Infinity) - (b.rankInClass ?? Infinity) || (b.average ?? 0) - (a.average ?? 0) || a.name.localeCompare(b.name));
    ordered = [...ranked, ...model.learners.filter((l) => !hasResult(l))];
  } else {
    ordered = model.learners;
  }

  const rows: MeritRow[] = ordered.map((learner) => ({
    position: positioned && hasResult(learner) ? learner.rankInClass : null,
    streamPosition: positioned && model.multiStream && hasResult(learner) ? learner.rankInStream : null,
    learner,
    hasResult: hasResult(learner),
  }));

  const positions = rows.map((r) => r.position).filter((p): p is number => p !== null);
  const subjectSummary: SubjectSummary[] = model.subjects.map((s) => {
    const st = model.subjectStats[s.id];
    return {
      subjectId: s.id,
      name: s.name,
      maxScore: s.maxScore,
      entered: st.entered,
      mean: st.mean,
      meanPercent: meanPercent(model, s.id, s.maxScore),
      highest: st.highest,
      highestBy: who(model, s.id, st.highest),
      lowest: st.lowest,
      lowestBy: who(model, s.id, st.lowest),
    };
  });

  return {
    title: positioned ? "MERIT LIST" : "EXAMINATION RESULTS",
    positioned,
    rows,
    subjectSummary,
    tiesPresent: new Set(positions).size < positions.length,
    noResultCount: rows.filter((r) => !r.hasResult).length,
    incompleteCount: rows.filter((r) => r.hasResult && r.learner.incomplete).length,
  };
}

/** Flat rows for Excel/CSV, from the same list the PDF prints. */
export function meritExportRows(model: MarkSheetModel, list: MeritList): Record<string, string | number>[] {
  return list.rows.map((r) => {
    const row: Record<string, string | number> = {};
    if (list.positioned) row["Position"] = r.position ?? MISSING;
    if (list.positioned && model.multiStream) row["Stream position"] = r.streamPosition ?? MISSING;
    row["Adm No"] = r.learner.admissionNumber;
    row["Learner"] = r.learner.name;
    if (model.multiStream) row["Stream"] = r.learner.streamName;
    for (const subject of model.subjects) {
      const cell = r.learner.cells[subject.id];
      row[subject.name] = cell.score !== null ? cell.score : cell.text;
    }
    row["Total"] = r.learner.total ?? MISSING;
    row["Average %"] = r.learner.average ?? MISSING;
    row["Results complete"] = r.hasResult ? (r.learner.incomplete ? "No" : "Yes") : "No result";
    return row;
  });
}
