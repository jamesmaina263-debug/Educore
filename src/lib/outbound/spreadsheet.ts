// Turns an uploaded .xlsx/.csv into CSV text for the outreach import. The text then goes through the
// same parseProspectCsv/RPC path as a pasted list, so validation, dedupe and the 500-row cap are shared.

export const MAX_UPLOAD_BYTES = 2_000_000;

function flattenCellValue(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === "object") {
    if ("result" in v) return flattenCellValue((v as { result: unknown }).result);
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    if ("text" in v) return String((v as { text: unknown }).text ?? "");
    if ("hyperlink" in v) return String((v as { hyperlink: unknown }).hyperlink ?? "");
  }
  return v === null || v === undefined ? "" : String(v);
}

function csvEscape(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Reads the first sheet of an .xlsx workbook and returns it as CSV text (empty rows dropped). */
export async function xlsxBufferToCsv(buf: ArrayBuffer): Promise<string> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return "";
  const lines: string[] = [];
  const width = ws.columnCount;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(flattenCellValue(row.getCell(c).value).trim());
    if (cells.some((x) => x !== "")) lines.push(cells.map(csvEscape).join(","));
  });
  return lines.join("\n");
}

export type ReadListResult = { ok: true; csv: string } | { ok: false; error: string };

/** Accepts .xlsx or .csv/.txt; anything else (including legacy .xls) gets a plain-language error. */
export async function readListFile(file: File): Promise<ReadListResult> {
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "That file is too large (max 2 MB)." };
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".xlsx")) {
      const csv = await xlsxBufferToCsv(await file.arrayBuffer());
      return csv ? { ok: true, csv } : { ok: false, error: "The spreadsheet looks empty." };
    }
    if (name.endsWith(".csv") || name.endsWith(".txt")) return { ok: true, csv: await file.text() };
    if (name.endsWith(".xls")) return { ok: false, error: "Old .xls files aren't supported. Save it as .xlsx or .csv and try again." };
    return { ok: false, error: "Choose an .xlsx or .csv file." };
  } catch {
    return { ok: false, error: "Couldn't read that file. Check it is a valid .xlsx or .csv." };
  }
}
