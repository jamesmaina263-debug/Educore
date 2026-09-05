// Report-card insight derivation (Performance Appraisal Engine directive,
// Phase 14 / roadmap Step 10). Pure and unit-tested, same convention as
// pathway-fit.ts and growth-trend.ts -- the calling server code fetches and
// shapes rows from marks/competency_marks/competency_indicator_ratings/
// growth-trend, this file only turns already-shaped data into what a report
// card actually displays: an achievement distribution (replacing class
// position as the headline visual, per the directive) plus a short,
// deterministic Strengths / Areas for Support list.
//
// Deliberately NOT a diagnosis or an AI judgment call -- every line here is
// a plain threshold rule (top band = strength, bottom band = support,
// improving/declining trend = strength/support) so a teacher reviewing a
// report card can always see exactly why something was listed, matching the
// directive's Phase 13 instruction: "Do not automatically diagnose learners
// or make unsupported psychological/educational claims. This is an academic
// performance support feature."

export interface AchievementBandCount {
  label: string;
  levelOrder: number;
  count: number;
}

/** One competency/value/PCI/sub-strand rating already resolved to its band. */
export interface RatedCompetency {
  name: string;
  label: string;
  levelOrder: number;
  /** The highest levelOrder available on this rating's own scale -- e.g. 8 for an 8-band KJSEA scale, 3 for the 3-2-1 competency scale. Needed because different scales aren't the same length. */
  maxLevelOrder: number;
}

export interface ReportCardInsightsInput {
  /** One entry per subject mark or competency mark that resolved to a band this exam/term. */
  achievementBands: { label: string; levelOrder: number }[];
  competencyRatings: RatedCompetency[];
  /** Subject names classified "improving" by growth-trend.ts over this student's recorded history. */
  improvingSubjects: string[];
  /** Subject names classified "declining" by growth-trend.ts. */
  decliningSubjects: string[];
}

export interface ReportCardInsights {
  achievementDistribution: AchievementBandCount[];
  strengths: string[];
  areasForSupport: string[];
}

export function buildReportCardInsights(input: ReportCardInsightsInput): ReportCardInsights {
  const distributionMap = new Map<string, AchievementBandCount>();
  for (const b of input.achievementBands) {
    const existing = distributionMap.get(b.label);
    if (existing) existing.count += 1;
    else distributionMap.set(b.label, { label: b.label, levelOrder: b.levelOrder, count: 1 });
  }
  const achievementDistribution = [...distributionMap.values()].sort((a, b) => b.levelOrder - a.levelOrder);

  const strengths: string[] = [];
  const areasForSupport: string[] = [];

  for (const c of [...input.competencyRatings].sort((a, b) => a.name.localeCompare(b.name))) {
    if (c.levelOrder === c.maxLevelOrder) {
      strengths.push(`${c.name} (${c.label})`);
    } else if (c.levelOrder === 1) {
      areasForSupport.push(`${c.name} (${c.label})`);
    }
  }

  for (const subject of [...input.improvingSubjects].sort()) {
    strengths.push(`${subject} -- improving`);
  }
  for (const subject of [...input.decliningSubjects].sort()) {
    areasForSupport.push(`${subject} -- declining`);
  }

  return { achievementDistribution, strengths, areasForSupport };
}
