// Configurable column layout for the provisional KNEC CBA export (Phase 5 follow-up). No
// official cba.knec.ac.ke upload template is publicly documented, so the export's column set,
// header labels, and order are school-editable data (schools.knec_cba_export_columns) rather
// than hardcoded -- a school can adjust it the moment they learn something concrete from the
// portal, without waiting on a code change. See the migration
// 20260903053000_knec_cba_export_configurable_columns.sql for the write path and validation.
//
// `key` always maps to the same underlying data field pulled from a batch's export rows
// (KnecCbaExportRow in integrations/actions.ts). `label` is what actually gets written as the
// CSV/XLSX header -- free text, so it can be renamed to match KNEC's real wording once known.

export type KnecCbaExportColumnKey =
  | "upi_number"
  | "admission_number"
  | "first_name"
  | "last_name"
  | "other_names"
  | "class_name"
  | "learning_area"
  | "strand"
  | "sub_strand"
  | "competency_level"
  | "knec_school_code";

export interface KnecCbaExportColumn {
  key: KnecCbaExportColumnKey;
  label: string;
  enabled: boolean;
}

/** Every field available to put in the export, in the order they'll appear when "reset to defaults" is used. */
export const KNEC_CBA_EXPORT_DEFAULT_COLUMNS: KnecCbaExportColumn[] = [
  { key: "upi_number", label: "UPI", enabled: true },
  { key: "admission_number", label: "Admission No", enabled: true },
  { key: "first_name", label: "First Name", enabled: true },
  { key: "last_name", label: "Surname", enabled: true },
  { key: "other_names", label: "Other Names", enabled: true },
  { key: "class_name", label: "Class", enabled: true },
  { key: "learning_area", label: "Learning Area", enabled: true },
  { key: "strand", label: "Strand", enabled: true },
  { key: "sub_strand", label: "Sub-Strand", enabled: true },
  { key: "competency_level", label: "Competency Level", enabled: true },
  { key: "knec_school_code", label: "KNEC School Code", enabled: false },
];

const KNOWN_KEYS = new Set(KNEC_CBA_EXPORT_DEFAULT_COLUMNS.map((c) => c.key));

/** Human-readable description shown next to each key in the configuration dialog. */
export const KNEC_CBA_EXPORT_COLUMN_DESCRIPTIONS: Record<KnecCbaExportColumnKey, string> = {
  upi_number: "The learner's Unique Personal Identifier (NEMIS/UPI number).",
  admission_number: "This school's own admission number for the learner.",
  first_name: "Learner's first name.",
  last_name: "Learner's surname.",
  other_names: "Any additional given names on record.",
  class_name: "Grade and stream the mark was recorded under, e.g. \"Grade 9 North\".",
  learning_area: "The subject (KICD Learning Area) the sub-strand belongs to.",
  strand: "The CBC strand the sub-strand belongs to.",
  sub_strand: "The specific sub-strand this competency level was assessed against.",
  competency_level: "The band label recorded for this student on this sub-strand.",
  knec_school_code: "This school's own 9-digit KNEC School Code, repeated on every row.",
};

/**
 * Parses whatever is stored in schools.knec_cba_export_columns into a valid, complete column
 * list. Falls back to the built-in defaults for anything missing or malformed, rather than
 * failing the export -- a corrupted or partial config should degrade to "provisional defaults",
 * never to a broken download.
 */
export function resolveKnecCbaExportColumns(stored: unknown): KnecCbaExportColumn[] {
  if (!Array.isArray(stored) || stored.length === 0) return KNEC_CBA_EXPORT_DEFAULT_COLUMNS;

  const seen = new Set<string>();
  const resolved: KnecCbaExportColumn[] = [];
  for (const entry of stored) {
    if (typeof entry !== "object" || entry === null) continue;
    const key = (entry as Record<string, unknown>).key;
    const label = (entry as Record<string, unknown>).label;
    const enabled = (entry as Record<string, unknown>).enabled;
    if (typeof key !== "string" || !KNOWN_KEYS.has(key as KnecCbaExportColumnKey)) continue;
    if (typeof label !== "string" || typeof enabled !== "boolean") continue;
    if (seen.has(key)) continue; // ignore a duplicate key rather than exporting a column twice
    seen.add(key);
    resolved.push({ key: key as KnecCbaExportColumnKey, label, enabled });
  }

  return resolved.length > 0 ? resolved : KNEC_CBA_EXPORT_DEFAULT_COLUMNS;
}

/**
 * Expands a resolved (possibly partial -- a school may have deleted a row it once had) column
 * list back out to cover every known key, for the editing UI: keeps the school's current
 * order/labels/enabled state for keys they've configured, and appends any key they've never
 * configured (or previously removed) at the end using its built-in default label, disabled. This
 * is what "Configure export columns" edits against -- resolveKnecCbaExportColumns (and therefore
 * the actual export) only ever uses what's enabled, so a key sitting here disabled has no effect
 * on a download until a school explicitly turns it on.
 */
export function withAllKnownColumns(configured: KnecCbaExportColumn[]): KnecCbaExportColumn[] {
  const configuredKeys = new Set(configured.map((c) => c.key));
  const missing = KNEC_CBA_EXPORT_DEFAULT_COLUMNS.filter((c) => !configuredKeys.has(c.key)).map((c) => ({
    ...c,
    enabled: false,
  }));
  return [...configured, ...missing];
}


export interface KnecCbaExportRowSource {
  upi_number: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  other_names: string;
  class_name: string;
  learning_area: string;
  strand: string;
  sub_strand: string;
  competency_level: string;
}

/**
 * Builds the flat, ordered objects ready to hand straight to a CSV/XLSX writer: one object per
 * row, keyed by each enabled column's current LABEL (not its key) and in configured order --
 * exactly what the school will see as headers in the download.
 */
export function buildKnecCbaExportSheetRows(
  rows: KnecCbaExportRowSource[],
  columns: KnecCbaExportColumn[],
  knecSchoolCode: string | null,
): Record<string, string>[] {
  const enabledColumns = columns.filter((c) => c.enabled);
  return rows.map((r) => {
    const out: Record<string, string> = {};
    for (const col of enabledColumns) {
      out[col.label] = col.key === "knec_school_code" ? (knecSchoolCode ?? "") : r[col.key as keyof KnecCbaExportRowSource];
    }
    return out;
  });
}
