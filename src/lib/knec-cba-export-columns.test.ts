import { describe, expect, it } from "vitest";
import {
  KNEC_CBA_EXPORT_DEFAULT_COLUMNS,
  resolveKnecCbaExportColumns,
  buildKnecCbaExportSheetRows,
  withAllKnownColumns,
  type KnecCbaExportRowSource,
} from "./knec-cba-export-columns";

describe("resolveKnecCbaExportColumns", () => {
  it("falls back to defaults for null (never configured)", () => {
    expect(resolveKnecCbaExportColumns(null)).toEqual(KNEC_CBA_EXPORT_DEFAULT_COLUMNS);
  });

  it("falls back to defaults for garbage input", () => {
    expect(resolveKnecCbaExportColumns("not an array")).toEqual(KNEC_CBA_EXPORT_DEFAULT_COLUMNS);
    expect(resolveKnecCbaExportColumns({})).toEqual(KNEC_CBA_EXPORT_DEFAULT_COLUMNS);
    expect(resolveKnecCbaExportColumns([])).toEqual(KNEC_CBA_EXPORT_DEFAULT_COLUMNS);
  });

  it("keeps a valid custom configuration, including renamed labels and a different order", () => {
    const custom = [
      { key: "sub_strand", label: "Sub Strand Name", enabled: true },
      { key: "competency_level", label: "Rating", enabled: true },
      { key: "admission_number", label: "Adm No", enabled: false },
    ];
    expect(resolveKnecCbaExportColumns(custom)).toEqual(custom);
  });

  it("drops entries with an unknown key rather than crashing", () => {
    const custom = [
      { key: "sub_strand", label: "Sub Strand", enabled: true },
      { key: "made_up_field", label: "???", enabled: true },
    ];
    const result = resolveKnecCbaExportColumns(custom);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("sub_strand");
  });

  it("drops entries missing a required field", () => {
    const custom = [
      { key: "sub_strand", label: "Sub Strand", enabled: true },
      { key: "competency_level", enabled: true }, // no label
      { key: "class_name", label: "Class" }, // no enabled
    ];
    const result = resolveKnecCbaExportColumns(custom);
    expect(result.map((c) => c.key)).toEqual(["sub_strand"]);
  });

  it("drops a duplicate key rather than exporting a column twice", () => {
    const custom = [
      { key: "sub_strand", label: "Sub Strand", enabled: true },
      { key: "sub_strand", label: "Sub Strand Again", enabled: true },
    ];
    const result = resolveKnecCbaExportColumns(custom);
    expect(result).toHaveLength(1);
  });

  it("falls back to defaults if every entry is invalid", () => {
    expect(resolveKnecCbaExportColumns([{ nope: true }])).toEqual(KNEC_CBA_EXPORT_DEFAULT_COLUMNS);
  });
});

describe("buildKnecCbaExportSheetRows", () => {
  const source: KnecCbaExportRowSource = {
    upi_number: "UPI123",
    admission_number: "ADM1",
    first_name: "Jane",
    last_name: "Doe",
    other_names: "",
    class_name: "Grade 9 North",
    learning_area: "Mathematics",
    strand: "Numbers",
    sub_strand: "Fractions",
    competency_level: "Meeting Expectation",
  };

  it("keys output rows by column LABEL, in configured order, skipping disabled columns", () => {
    const columns = [
      { key: "sub_strand" as const, label: "Sub Strand", enabled: true },
      { key: "admission_number" as const, label: "Adm No", enabled: false },
      { key: "competency_level" as const, label: "Rating", enabled: true },
    ];
    const result = buildKnecCbaExportSheetRows([source], columns, null);
    expect(result).toEqual([{ "Sub Strand": "Fractions", Rating: "Meeting Expectation" }]);
  });

  it("repeats the school's own KNEC code on every row when that column is enabled", () => {
    const columns = [{ key: "knec_school_code" as const, label: "KNEC Code", enabled: true }];
    const result = buildKnecCbaExportSheetRows([source, source], columns, "123456789");
    expect(result).toEqual([{ "KNEC Code": "123456789" }, { "KNEC Code": "123456789" }]);
  });

  it("uses an empty string for the KNEC code column when the school hasn't set one", () => {
    const columns = [{ key: "knec_school_code" as const, label: "KNEC Code", enabled: true }];
    expect(buildKnecCbaExportSheetRows([source], columns, null)).toEqual([{ "KNEC Code": "" }]);
  });
});

describe("withAllKnownColumns", () => {
  it("returns the full default set unchanged when given the defaults", () => {
    expect(withAllKnownColumns(KNEC_CBA_EXPORT_DEFAULT_COLUMNS)).toEqual(KNEC_CBA_EXPORT_DEFAULT_COLUMNS);
  });

  it("appends a previously-removed known key at the end, disabled, without disturbing the rest", () => {
    const partial = KNEC_CBA_EXPORT_DEFAULT_COLUMNS.filter((c) => c.key !== "other_names");
    const result = withAllKnownColumns(partial);
    expect(result).toHaveLength(KNEC_CBA_EXPORT_DEFAULT_COLUMNS.length);
    expect(result.slice(0, -1)).toEqual(partial);
    expect(result[result.length - 1]).toEqual({ key: "other_names", label: "Other Names", enabled: false });
  });

  it("preserves a custom label/enabled state for keys already configured", () => {
    const partial = [{ key: "sub_strand" as const, label: "Sub Strand Renamed", enabled: false }];
    const result = withAllKnownColumns(partial);
    expect(result[0]).toEqual({ key: "sub_strand", label: "Sub Strand Renamed", enabled: false });
    expect(result).toHaveLength(KNEC_CBA_EXPORT_DEFAULT_COLUMNS.length);
  });
});
