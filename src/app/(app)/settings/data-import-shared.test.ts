import { describe, expect, it } from "vitest";
import { IMPORT_SHEET_HEADERS, classStreamCells } from "./data-import-shared";

describe("Students export/import round trip", () => {
  const headers = IMPORT_SHEET_HEADERS.Students;

  it("has separate Class and Stream columns (the importer reads both), not a combined one", () => {
    expect(headers).toContain("Class");
    expect(headers).toContain("Stream");
    expect(headers).not.toContain("Class/Stream");
  });

  it("emits Class then Stream cells for a student with a stream", () => {
    expect(classStreamCells({ name: "Stream A", classes: { name: "S.1" } })).toEqual(["S.1", "Stream A"]);
  });

  it("emits blank cells, not 'Unassigned', for a student with no stream", () => {
    expect(classStreamCells(null)).toEqual(["", ""]);
    expect(classStreamCells({ name: "Stream A", classes: null })).toEqual(["", "Stream A"]);
  });

  it("places the two cells exactly under the Class and Stream headers", () => {
    const row = ["007", "", "A", "B", "", "2015-01-01", "male", ...classStreamCells({ name: "S.B", classes: { name: "S.1B" } }), "active", "2026-01-05"];
    expect(row).toHaveLength(headers.length);
    expect(row[headers.indexOf("Class")]).toBe("S.1B");
    expect(row[headers.indexOf("Stream")]).toBe("S.B");
  });
});
