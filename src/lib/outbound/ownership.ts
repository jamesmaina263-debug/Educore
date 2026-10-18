// Is this school probably privately owned? EduCore sells to fee-paying schools, so most government
// schools are a weak fit. We can't know ownership for sure from a name, so this is a SIGNAL, not a
// fact: it is shown as "likely", never written into the database, and the filters that use it default
// to HIDING likely-public schools rather than deleting anything. Pure functions, no I/O.

export type OwnershipSignal = "private_tagged" | "public_tagged" | "likely_private" | "likely_public" | "unknown";

export const OWNERSHIP_LABELS: Record<OwnershipSignal, string> = {
  private_tagged: "Private (map tag)",
  public_tagged: "Public (map tag)",
  likely_private: "Likely private",
  likely_public: "Likely public",
  unknown: "Ownership unknown",
};

export type OwnershipInput = {
  school_name: string;
  school_type?: string | null;
  school_level?: string | null;
};

// Words that strongly suggest a private school. Deliberately NOT included: "junior" (under CBC,
// government "Junior School" is a real public category) and church names (sponsored schools are usually
// government-aided).
const PRIVATE_WORDS =
  /\b(academy|academies|preparatory|prep|international|montessori|kindergarten|nursery|pre-?school|preschool|playgroup|day ?care|learning (centre|center)|schools? of excellence|cambridge|igcse|british|american)\b/i;

// Names that read like government schools: single-sex "Boys/Girls" schools, High/Secondary schools,
// plain "X Primary School" / "X Secondary" / "X Sec" (OpenStreetMap names are often abbreviated).
const PUBLIC_WORDS = /\b(boys?|girls?|high|secondary|sec|primary|pri|mixed day|national school|county school|day school)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function ownershipSignal(p: OwnershipInput): OwnershipSignal {
  if (p.school_type === "private") return "private_tagged";
  if (p.school_type === "public") return "public_tagged";
  const name = norm(p.school_name);
  if (PRIVATE_WORDS.test(name)) return "likely_private";
  if (p.school_level === "kindergarten") return "likely_private";
  if (PUBLIC_WORDS.test(name)) return "likely_public";
  return "unknown";
}

export type OwnershipFilter = "all" | "hide_public" | "private_only";

export const OWNERSHIP_FILTERS: ReadonlyArray<{ value: OwnershipFilter; label: string }> = [
  { value: "hide_public", label: "Hide likely public (recommended)" },
  { value: "private_only", label: "Private-leaning only" },
  { value: "all", label: "Everything" },
];

export function isOwnershipFilter(v: string): v is OwnershipFilter {
  return v === "all" || v === "hide_public" || v === "private_only";
}

export function passesOwnershipFilter(signal: OwnershipSignal, filter: OwnershipFilter): boolean {
  if (filter === "all") return true;
  if (filter === "private_only") return signal === "private_tagged" || signal === "likely_private";
  return signal !== "public_tagged" && signal !== "likely_public"; // hide_public: unknown schools are kept
}
