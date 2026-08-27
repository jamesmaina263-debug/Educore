import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildXlsxWorkbook, sheetFromObjectRows } from "./xlsx-export";

async function reload(buffer: ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

describe("sheetFromObjectRows", () => {
  it("takes column order from the first row's keys", () => {
    const sheet = sheetFromObjectRows("Sheet1", [
      { B: 2, A: 1 },
      { B: 4, A: 3 },
    ]);
    expect(sheet.headers).toEqual(["B", "A"]);
    expect(sheet.rows).toEqual([
      [2, 1],
      [4, 3],
    ]);
  });

  it("returns no headers for an empty row set", () => {
    expect(sheetFromObjectRows("Sheet1", [])).toEqual({ name: "Sheet1", headers: [], rows: [] });
  });
});

describe("buildXlsxWorkbook", () => {
  it("produces a workbook a spreadsheet reader can load back, with headers and data intact", async () => {
    const buffer = await buildXlsxWorkbook([
      sheetFromObjectRows("Learners", [
        { Name: "Wanjiku Kamau", "Adm No": "A001" },
        { Name: "Otieno Omondi", "Adm No": "A002" },
      ]),
    ]);

    const wb = await reload(buffer);
    const sheet = wb.worksheets[0];
    expect(sheet.name).toBe("Learners");
    expect(sheet.getRow(1).values).toEqual([undefined, "Name", "Adm No"]);
    expect(sheet.getRow(2).values).toEqual([undefined, "Wanjiku Kamau", "A001"]);
    expect(sheet.getRow(3).values).toEqual([undefined, "Otieno Omondi", "A002"]);
  });

  it("supports multiple sheets in one workbook", async () => {
    const buffer = await buildXlsxWorkbook([
      { name: "Summary", headers: ["Metric", "Value"], rows: [["Students", 120]] },
      { name: "Attendance", headers: ["Date", "Present"], rows: [["2026-08-24", 118]] },
    ]);

    const wb = await reload(buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Summary", "Attendance"]);
  });

  it("truncates sheet names to Excel's 31-character limit", async () => {
    const longName = "A".repeat(50);
    const buffer = await buildXlsxWorkbook([{ name: longName, headers: [], rows: [] }]);
    const wb = await reload(buffer);
    expect(wb.worksheets[0].name.length).toBeLessThanOrEqual(31);
  });

  it("omits the header row entirely when headers is empty", async () => {
    const buffer = await buildXlsxWorkbook([{ name: "Sheet1", headers: [], rows: [["a", "b"]] }]);
    const wb = await reload(buffer);
    expect(wb.worksheets[0].getRow(1).values).toEqual([undefined, "a", "b"]);
  });
});
