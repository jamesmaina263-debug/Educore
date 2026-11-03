import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORDING,
  EMPTY_REPORT_FORM_LAYOUT,
  REPORT_FORM_LIMITS,
  loadReportFormLayout,
  resolveReportFormLayout,
  validateReportFormInput,
} from "./report-form-layout";

describe("resolveReportFormLayout", () => {
  it("maps a stored row, trimming and turning blanks into null", () => {
    expect(
      resolveReportFormLayout({ title: "  Progress Report ", subtitle: "", footer_note: "Note", class_teacher_label: null, head_teacher_label: "  ", parent_label: "Guardian" }),
    ).toEqual({ title: "Progress Report", subtitle: null, footerNote: "Note", classTeacherLabel: null, headTeacherLabel: null, parentLabel: "Guardian" });
  });
  it("returns null for no row or anything that is not an object", () => {
    for (const v of [null, undefined, "x", 5, []]) expect(resolveReportFormLayout(v)).toBeNull();
  });
  it("ignores non-string values", () => {
    expect(resolveReportFormLayout({ title: 5, footer_note: {} })).toEqual(EMPTY_REPORT_FORM_LAYOUT);
  });
});

describe("validateReportFormInput", () => {
  it("accepts an empty layout and good wording", () => {
    expect(validateReportFormInput(EMPTY_REPORT_FORM_LAYOUT)).toBeNull();
    expect(validateReportFormInput({ ...EMPTY_REPORT_FORM_LAYOUT, title: "Progress Report", footerNote: "x".repeat(REPORT_FORM_LIMITS.footerNote) })).toBeNull();
  });
  it("rejects over-long fields, naming the field", () => {
    expect(validateReportFormInput({ ...EMPTY_REPORT_FORM_LAYOUT, title: "x".repeat(61) })).toMatch(/Title.*60/);
    expect(validateReportFormInput({ ...EMPTY_REPORT_FORM_LAYOUT, parentLabel: "x".repeat(41) })).toMatch(/Parent label.*40/);
  });
  it("rejects line breaks and control characters", () => {
    expect(validateReportFormInput({ ...EMPTY_REPORT_FORM_LAYOUT, footerNote: "a\nb" })).toMatch(/invalid characters/);
    expect(validateReportFormInput({ ...EMPTY_REPORT_FORM_LAYOUT, title: "a\u0000b" })).toMatch(/invalid characters/);
  });
});

describe("defaults", () => {
  it("keeps the original card wording", () => {
    expect(DEFAULT_WORDING).toEqual({ title: "Report Card", classTeacherLabel: "Class teacher", headTeacherLabel: "Principal", parentLabel: "Parent / Guardian" });
  });
});

describe("loadReportFormLayout", () => {
  const client = (result: unknown, throws = false) =>
    ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: () => (throws ? Promise.reject(new Error("boom")) : Promise.resolve(result)) }),
        }),
      }),
    }) as never;

  it("returns the layout when the row is visible", async () => {
    expect(await loadReportFormLayout(client({ data: { title: "T" }, error: null }), "s")).toMatchObject({ title: "T" });
  });
  it("returns null with no row (flag off hides it via RLS), on an error, or when the call throws", async () => {
    expect(await loadReportFormLayout(client({ data: null, error: null }), "s")).toBeNull();
    expect(await loadReportFormLayout(client({ data: null, error: { message: "x" } }), "s")).toBeNull();
    expect(await loadReportFormLayout(client(null, true), "s")).toBeNull();
  });
});
