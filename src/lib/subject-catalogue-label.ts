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
