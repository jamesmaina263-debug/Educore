// Browser-side CSV export. Uses papaparse's `unparse` for correct quoting/escaping (the same
// dependency already used to *parse* CSV uploads elsewhere -- see reconciliation-section.tsx and
// timetable-upload-dialog.tsx) rather than hand-rolling CSV string-building.

import { downloadBlob } from "@/lib/xlsx-export";

export const CSV_MIME = "text/csv;charset=utf-8;";

/** Converts uniform objects to a CSV string, taking column order from the first row's keys. */
export async function buildCsv(rows: Record<string, string | number>[]): Promise<string> {
  const Papa = (await import("papaparse")).default;
  return Papa.unparse(rows);
}

/** Convenience wrapper: builds a CSV from object rows and triggers a browser download. */
export async function downloadCsvFromObjectRows(rows: Record<string, string | number>[], filename: string) {
  const csv = await buildCsv(rows);
  downloadBlob(csv, filename, CSV_MIME);
}
