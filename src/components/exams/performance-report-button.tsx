"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadLogo } from "@/components/shared/table-export-menu";
import type { PerformanceReport } from "@/lib/academics/performance-report-model";
import type { PdfSchoolHeader } from "@/lib/pdf/pdf-common";

export interface ReportSchool extends PdfSchoolHeader {
  logoUrl: string | null;
}

/** Downloads a PerformanceReport as a PDF with charts. The report is built (and every number formatted) by the caller. */
export function PerformanceReportButton({ report, school, fileName, label = "Download PDF report" }: { report: PerformanceReport; school: ReportSchool; fileName: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const { buildPerformanceReportPdf } = await import("@/lib/pdf/performance-report-pdf");
      const logo = school.logoUrl ? await loadLogo(school.logoUrl) : null;
      (await buildPerformanceReportPdf(report, school, logo)).save(`${fileName}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={run}>
        <Download className="size-4" aria-hidden /> {busy ? "Preparing…" : label}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
