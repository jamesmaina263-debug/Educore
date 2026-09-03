// Senior School pathway-fit guidance (Phase 6 of the CBC/CBE investigation report).
//
// Purpose: turn a student's already-recorded subject marks into an ADVISORY signal
// about which real KICD/KNEC Senior School pathway (STEM / Social Sciences /
// Arts & Sports Science) their strongest recorded performance leans toward. This is
// guidance only -- it never blocks, gates, or auto-assigns a pathway. It reuses two
// pieces of infrastructure that already exist and are correct:
//   - subject_catalogue.pathway -- the real Pathway taxonomy a school's activated
//     subjects are drawn from (see 20260816112202_subject_catalogue_and_school_activation.sql).
//   - marks -- one row per (exam, student, subject), holding exactly one of
//     raw_score (numeric model) or band_id -> grading_scale_bands.label (CBC model)
//     (see 20260730151554_exams_marks.sql).
//
// Deliberately excludes: any table write, any new permission, any auto-recommendation
// presented as a decision. Callers must always label this "advisory" in the UI.

/** One subject's contribution to the fit calculation, already joined from marks + subjects + subject_catalogue. */
export interface PathwayFitMarkInput {
  subjectId: string;
  subjectName: string;
  /** subject_catalogue.pathway for the subject this mark was recorded against. Null if the
   *  subject isn't linked to a catalogue row (shouldn't happen post-migration, but degrade safely). */
  pathway: string | null;
  isCore: boolean;
  rawScore: number | null;
  maxScore: number | null;
  bandLabel: string | null;
}

export interface SubjectFitScore {
  subjectId: string;
  subjectName: string;
  /** 0-100, averaged across every mark recorded for this subject. */
  percent: number;
  /** How many individual marks contributed to this subject's average. */
  markCount: number;
}

export interface PathwayFitResult {
  pathway: string;
  /** 0-100, the equal-weighted average of this pathway's subject percentages. */
  averagePercent: number;
  subjects: SubjectFitScore[];
}

export interface PathwayFitSummary {
  /** True once there is at least one pathway with a scored subject to show. */
  eligible: boolean;
  /** Set when eligible is false, explaining why (e.g. no marks yet, only Core subjects recorded). */
  ineligibleReason?: string;
  /** Best-fit pathway first. Only STEM / Social Sciences / Arts & Sports Science ever appear here --
   *  Core is excluded because every learner takes Core subjects regardless of pathway, so Core
   *  performance doesn't discriminate between pathway choices. */
  pathways: PathwayFitResult[];
}

const PATHWAY_ORDER = ["STEM", "Social Sciences", "Arts & Sports Science"];

// Real, official KICD/KNEC CBC competency-level wording (verified in the CBC/CBE investigation
// report). Matched by label text, not by grading_scale_bands.level_order -- level_order is just
// whatever order a school typed its bands into the Grading Scales form (see
// grading-scales-section.tsx) and carries no guaranteed best-to-worst direction. A school using
// the standard wording is scored correctly; a school with different custom CBC wording safely
// contributes no score for that mark rather than a guessed/wrong one. This mirrors the exact
// convention already established in src/app/(app)/ai/actions.ts (students_needing_competency_support).
const CBC_BAND_SCORE: { pattern: RegExp; percent: number }[] = [
  { pattern: /exceed/i, percent: 100 },
  { pattern: /meet/i, percent: 75 },
  { pattern: /approach/i, percent: 50 },
  { pattern: /below/i, percent: 25 },
];

/** Scores a single mark to a 0-100 scale, or null if it can't be scored without guessing. */
export function scoreMark(input: Pick<PathwayFitMarkInput, "rawScore" | "maxScore" | "bandLabel">): number | null {
  if (input.rawScore !== null && input.maxScore !== null && input.maxScore > 0) {
    const pct = (input.rawScore / input.maxScore) * 100;
    return Math.max(0, Math.min(100, pct));
  }
  if (input.bandLabel) {
    const match = CBC_BAND_SCORE.find((b) => b.pattern.test(input.bandLabel as string));
    if (match) return match.percent;
  }
  return null;
}

/** Minimum distinct pathway-mapped subjects (across all non-Core pathways combined) before
 *  showing a comparison at all -- one subject's worth of data isn't a meaningful "fit" signal. */
const MIN_SCORED_SUBJECTS = 2;

export function computePathwayFit(marks: PathwayFitMarkInput[]): PathwayFitSummary {
  // subjectId -> running total, for averaging multiple marks (different exams/terms) per subject.
  const bySubject = new Map<
    string,
    { subjectName: string; pathway: string; sum: number; count: number }
  >();

  for (const m of marks) {
    if (m.isCore) continue; // Core is compulsory for every pathway -- not discriminating.
    if (!m.pathway || !PATHWAY_ORDER.includes(m.pathway)) continue; // unmapped/unknown pathway -- skip, don't guess.
    const scored = scoreMark(m);
    if (scored === null) continue;

    const existing = bySubject.get(m.subjectId);
    if (existing) {
      existing.sum += scored;
      existing.count += 1;
    } else {
      bySubject.set(m.subjectId, { subjectName: m.subjectName, pathway: m.pathway, sum: scored, count: 1 });
    }
  }

  if (bySubject.size < MIN_SCORED_SUBJECTS) {
    return {
      eligible: false,
      ineligibleReason:
        bySubject.size === 0
          ? "No recorded marks yet for a pathway (STEM / Social Sciences / Arts & Sports Science) subject."
          : "Only one pathway-mapped subject has recorded marks so far -- not enough to compare pathways.",
      pathways: [],
    };
  }

  const byPathway = new Map<string, SubjectFitScore[]>();
  for (const [subjectId, s] of bySubject) {
    const list = byPathway.get(s.pathway) ?? [];
    list.push({ subjectId, subjectName: s.subjectName, percent: Math.round((s.sum / s.count) * 10) / 10, markCount: s.count });
    byPathway.set(s.pathway, list);
  }

  const pathways: PathwayFitResult[] = PATHWAY_ORDER.filter((p) => byPathway.has(p)).map((pathway) => {
    const subjects = (byPathway.get(pathway) ?? []).sort((a, b) => b.percent - a.percent);
    const averagePercent =
      Math.round((subjects.reduce((sum, s) => sum + s.percent, 0) / subjects.length) * 10) / 10;
    return { pathway, averagePercent, subjects };
  });

  pathways.sort((a, b) => b.averagePercent - a.averagePercent);

  return { eligible: true, pathways };
}
