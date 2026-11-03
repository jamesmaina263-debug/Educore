import type { createClient } from "@/lib/supabase/server";

// WP 7.7: the wording a school may change on the printed report card. Stored one row per school in
// report_form_layouts (flag feature.reports.custom_forms, written only by save_report_form_layout()).
// A null field means "EduCore's default wording", so no row / flag off / any read error prints exactly
// as before. Rendering only: this changes words, never marks, ranks or what is released.

export const REPORT_FORM_FLAG = "feature.reports.custom_forms";

export interface ReportFormLayout {
  title: string | null;
  subtitle: string | null;
  footerNote: string | null;
  classTeacherLabel: string | null;
  headTeacherLabel: string | null;
  parentLabel: string | null;
}

export const EMPTY_REPORT_FORM_LAYOUT: ReportFormLayout = {
  title: null,
  subtitle: null,
  footerNote: null,
  classTeacherLabel: null,
  headTeacherLabel: null,
  parentLabel: null,
};

export const DEFAULT_WORDING = {
  title: "Report Card",
  classTeacherLabel: "Class teacher",
  headTeacherLabel: "Principal",
  parentLabel: "Parent / Guardian",
} as const;

/** Must match the database checks in report_form_layouts / save_report_form_layout(). */
export const REPORT_FORM_LIMITS = { title: 60, subtitle: 120, footerNote: 300, label: 40 } as const;

const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v === "" ? null : v;
}

/** A stored row -> the layout; anything that is not an object resolves to null (= no custom layout). */
export function resolveReportFormLayout(row: unknown): ReportFormLayout | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  return {
    title: clean(r.title),
    subtitle: clean(r.subtitle),
    footerNote: clean(r.footer_note),
    classTeacherLabel: clean(r.class_teacher_label),
    headTeacherLabel: clean(r.head_teacher_label),
    parentLabel: clean(r.parent_label),
  };
}

/** Friendly pre-check for the designer form; the database re-checks everything. */
export function validateReportFormInput(input: ReportFormLayout): string | null {
  const fields: [string, string | null, number][] = [
    ["Title", input.title, REPORT_FORM_LIMITS.title],
    ["Subtitle", input.subtitle, REPORT_FORM_LIMITS.subtitle],
    ["Footer note", input.footerNote, REPORT_FORM_LIMITS.footerNote],
    ["Class teacher label", input.classTeacherLabel, REPORT_FORM_LIMITS.label],
    ["Head teacher label", input.headTeacherLabel, REPORT_FORM_LIMITS.label],
    ["Parent label", input.parentLabel, REPORT_FORM_LIMITS.label],
  ];
  for (const [name, value, max] of fields) {
    if (value === null) continue;
    const v = value.trim();
    if (v.length > max) return `${name} must be ${max} characters or fewer.`;
    if (CONTROL_RE.test(v)) return `${name} contains invalid characters (line breaks are not supported).`;
  }
  return null;
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Reads the caller's own school row (RLS). Returns null when the flag is off, no row exists, or anything
 * goes wrong: a report card must never fail to render because of its decoration.
 */
export async function loadReportFormLayout(supabase: Client, schoolId: string): Promise<ReportFormLayout | null> {
  try {
    const { data, error } = await supabase
      .from("report_form_layouts")
      .select("title, subtitle, footer_note, class_teacher_label, head_teacher_label, parent_label")
      .eq("school_id", schoolId)
      .maybeSingle();
    if (error) return null;
    return resolveReportFormLayout(data);
  } catch {
    return null;
  }
}
