// subject_catalogue holds one row per (name, grade_band), so the same subject
// name (e.g. "Mathematics") appears once per band. Show the band so admins can
// tell the copies apart.
export const GRADE_BAND_ORDER = ["pre_primary", "lower_primary", "upper_primary", "junior_school", "senior_school"] as const;

const GRADE_BAND_LABELS: Record<string, string> = {
  pre_primary: "Pre-primary (PP1–PP2)",
  lower_primary: "Lower primary (G1–3)",
  upper_primary: "Upper primary (G4–6)",
  junior_school: "Junior school (G7–9)",
  senior_school: "Senior school (G10–12)",
};

export function gradeBandLabel(band: string | null | undefined): string {
  if (!band) return "";
  return GRADE_BAND_LABELS[band] ?? band;
}

export function catalogueOptionLabel(name: string, band: string | null | undefined): string {
  const label = gradeBandLabel(band);
  return label ? `${name} — ${label}` : name;
}

/** Sort by subject name, then by grade band in curriculum order. */
export function compareCatalogueOptions(
  a: { name: string; grade_band?: string | null },
  b: { name: string; grade_band?: string | null },
): number {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  const rank = (band?: string | null) => {
    const i = GRADE_BAND_ORDER.indexOf((band ?? "") as (typeof GRADE_BAND_ORDER)[number]);
    return i === -1 ? GRADE_BAND_ORDER.length : i;
  };
  return rank(a.grade_band) - rank(b.grade_band);
}

type SubjectWithBand = { id: string; name: string; subject_catalogue?: { grade_band: string | null } | { grade_band: string | null }[] | null };

/**
 * Dropdown options for a school's own subjects. A school can hold the same
 * subject name once per grade band (e.g. Mathematics from the Upper primary
 * AND Senior school catalogue entries), which are otherwise indistinguishable.
 * Only names that actually repeat get a band suffix, so the common case stays
 * uncluttered.
 */
export function labelSubjectOptions(subjects: SubjectWithBand[]): { id: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const s of subjects) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  const bandOf = (s: SubjectWithBand): string | null => {
    const c = s.subject_catalogue;
    return (Array.isArray(c) ? c[0]?.grade_band : c?.grade_band) ?? null;
  };
  return subjects
    .map((s) => ({ s, band: bandOf(s) }))
    .sort((a, b) => compareCatalogueOptions({ name: a.s.name, grade_band: a.band }, { name: b.s.name, grade_band: b.band }))
    .map(({ s, band }) => ({ id: s.id, label: (counts.get(s.name) ?? 0) > 1 ? catalogueOptionLabel(s.name, band) : s.name }));
}
