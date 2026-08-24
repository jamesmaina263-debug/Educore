// Browser-side .xlsx export, built on exceljs instead of the `xlsx` (SheetJS) package.
// The npm-registry build of `xlsx` is stuck on 0.18.5 and carries unpatched prototype-
// pollution/DoS advisories; the fixed 0.19.3+ line is only distributed from SheetJS's own
// CDN, which isn't something we want to pull into the dependency tree sight-unseen. exceljs
// is already a project dependency (used to *parse* uploaded timetables) and covers writing
// just as well, so every export call site is consolidated onto it here instead.

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface XlsxSheetSpec {
  /** Sheet tab name. Excel caps this at 31 characters; longer names are truncated. */
  name: string;
  /** Header row values, in column order. Pass an empty array to omit a header row. */
  headers: (string | number)[];
  /** Data rows, each already in the same column order as `headers`. */
  rows: (string | number)[][];
}

/** Converts an array of uniform objects into a sheet spec, taking column order from the first row's keys. */
export function sheetFromObjectRows(name: string, rows: Record<string, string | number>[]): XlsxSheetSpec {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { name, headers, rows: rows.map((r) => headers.map((h) => r[h] ?? "")) };
}

/** Builds a .xlsx workbook from one or more sheets and returns it as an ArrayBuffer ready for a Blob. */
export async function buildXlsxWorkbook(sheets: XlsxSheetSpec[]): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31) || "Sheet1");
    if (sheet.headers.length > 0) ws.addRow(sheet.headers);
    for (const row of sheet.rows) ws.addRow(row);
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Triggers a browser download for arbitrary blob content (CSV, XLSX, PDF, ...). */
export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Convenience wrapper for the common single-sheet, object-rows export. */
export async function downloadXlsxFromObjectRows(
  rows: Record<string, string | number>[],
  sheetName: string,
  filename: string,
) {
  const buffer = await buildXlsxWorkbook([sheetFromObjectRows(sheetName, rows)]);
  downloadBlob(buffer, filename, XLSX_MIME);
}
