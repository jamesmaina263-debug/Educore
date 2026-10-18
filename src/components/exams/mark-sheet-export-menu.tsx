"use client";

import { TableExportMenu, loadLogo } from "@/components/shared/table-export-menu";
import { markSheetExportRows, type MarkSheetModel } from "@/lib/academics/mark-sheet-model";
import { buildMarkSheetPdf } from "@/lib/pdf/mark-sheet-pdf";

// Thin client wrapper: Excel/CSV come from the shared menu using rows derived from the model;
// "Export as PDF" is swapped for the dedicated mark sheet document. A client component because
// the logo is loaded through <img> + canvas and the PDF is generated in the browser, as before.
export function MarkSheetExportMenu({ model, filenameStub }: { model: MarkSheetModel; filenameStub: string }) {
  async function exportPdf() {
    const logo = model.school.logoUrl ? await loadLogo(model.school.logoUrl) : null;
    const doc = await buildMarkSheetPdf(model, logo);
    doc.save(`${filenameStub.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
  }
  return (
    <TableExportMenu
      filenameStub={filenameStub}
      title="Class Mark Sheet"
      rows={markSheetExportRows(model)}
      onExportPdf={exportPdf}
    />
  );
}
