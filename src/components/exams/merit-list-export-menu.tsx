"use client";

import { TableExportMenu, loadLogo } from "@/components/shared/table-export-menu";
import type { MarkSheetModel } from "@/lib/academics/mark-sheet-model";
import { buildMeritList, meritExportRows } from "@/lib/academics/merit-list";
import { buildMeritListPdf } from "@/lib/pdf/merit-list-pdf";

// Client wrapper (logo loading and PDF generation happen in the browser, as for the mark sheet).
// Excel/CSV come from the shared menu using the same merit list the PDF prints.
export function MeritListExportMenu({ model, filenameStub }: { model: MarkSheetModel; filenameStub: string }) {
  const list = buildMeritList(model);
  async function exportPdf() {
    const logo = model.school.logoUrl ? await loadLogo(model.school.logoUrl) : null;
    const doc = await buildMeritListPdf(model, list, logo);
    doc.save(`${filenameStub.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
  }
  return (
    <TableExportMenu
      filenameStub={filenameStub}
      title={list.title === "MERIT LIST" ? "Merit List" : "Examination Results"}
      label={list.positioned ? "Merit list" : "Results list"}
      rows={meritExportRows(model, list)}
      onExportPdf={exportPdf}
    />
  );
}
