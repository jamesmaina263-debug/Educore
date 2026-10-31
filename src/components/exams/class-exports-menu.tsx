"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { exportCSV, exportExcel, loadLogo } from "@/components/shared/table-export-menu";
import { getMarkSheetModel } from "@/app/(app)/exams/report-cards/export-actions";
import { markSheetExportRows, type MarkSheetModel } from "@/lib/academics/mark-sheet-model";
import { buildMeritList, meritExportRows, meritListEligibility } from "@/lib/academics/merit-list";

// The class Mark sheet and Merit list exports. The data behind them is a whole class's marks, so it is
// NOT loaded with the page: it is fetched the first time a menu is opened (and cached for the session
// on this page), which is normally done by the time an item is picked. The files themselves are built
// exactly as before (same rows, same PDF builders); only when the data loads has changed.
export function ClassExportsMenu({ examId, classId, filenameBase }: { examId: string; classId: string; filenameBase: string }) {
  const modelPromise = useRef<Promise<{ error: string } | { model: MarkSheetModel }> | null>(null);
  const [busy, setBusy] = useState<"mark" | "merit" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // One request per page view; a failed attempt is forgotten so the next open retries.
  function ensureModel() {
    if (!modelPromise.current) {
      modelPromise.current = getMarkSheetModel(examId, classId).then((res) => {
        if ("error" in res) modelPromise.current = null;
        return res;
      });
    }
    return modelPromise.current;
  }

  async function run(kind: "mark" | "merit", action: (model: MarkSheetModel) => Promise<void> | void) {
    setBusy(kind);
    setMessage(null);
    try {
      const res = await ensureModel();
      if ("error" in res) return setMessage(res.error);
      await action(res.model);
    } catch {
      setMessage("Couldn't create the file. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const stub = (suffix: string) => `${filenameBase}-${suffix}`;
  const fileName = (suffix: string) => stub(suffix).replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  const markSheet = {
    csv: () => run("mark", (m) => exportCSV(markSheetExportRows(m), stub("mark-sheet"))),
    excel: () => run("mark", (m) => exportExcel(markSheetExportRows(m), stub("mark-sheet"), "Class Mark Sheet")),
    pdf: () =>
      run("mark", async (m) => {
        const { buildMarkSheetPdf } = await import("@/lib/pdf/mark-sheet-pdf");
        const logo = m.school.logoUrl ? await loadLogo(m.school.logoUrl) : null;
        (await buildMarkSheetPdf(m, logo)).save(`${fileName("mark-sheet")}.pdf`);
      }),
  };

  // Merit list: only for numeric assessments; for CBC / mixed / empty the reason is shown instead.
  const merit = (kind: "csv" | "excel" | "pdf") =>
    run("merit", async (m) => {
      const eligibility = meritListEligibility(m);
      if (!eligibility.available) return setMessage(`Merit list isn't available: ${eligibility.reason}`);
      const list = buildMeritList(m);
      const title = list.title === "MERIT LIST" ? "Merit List" : "Examination Results";
      if (kind === "csv") return exportCSV(meritExportRows(m, list), stub("merit-list"));
      if (kind === "excel") return exportExcel(meritExportRows(m, list), stub("merit-list"), title);
      const { buildMeritListPdf } = await import("@/lib/pdf/merit-list-pdf");
      const logo = m.school.logoUrl ? await loadLogo(m.school.logoUrl) : null;
      (await buildMeritListPdf(m, list, logo)).save(`${fileName("merit-list")}.pdf`);
    });

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu onOpenChange={(open) => open && void ensureModel()}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy === "mark"}>
            <Download className="size-4" aria-hidden /> {busy === "mark" ? "Preparing…" : "Mark sheet"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={markSheet.csv}>Export as CSV</DropdownMenuItem>
          <DropdownMenuItem onClick={markSheet.excel}>Export as Excel</DropdownMenuItem>
          <DropdownMenuItem onClick={markSheet.pdf}>Export as PDF</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu onOpenChange={(open) => open && void ensureModel()}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy === "merit"}>
            <Download className="size-4" aria-hidden /> {busy === "merit" ? "Preparing…" : "Merit list"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => merit("csv")}>Export as CSV</DropdownMenuItem>
          <DropdownMenuItem onClick={() => merit("excel")}>Export as Excel</DropdownMenuItem>
          <DropdownMenuItem onClick={() => merit("pdf")}>Export as PDF</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {message && (
        <span className="max-w-xs text-xs text-muted-foreground" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
