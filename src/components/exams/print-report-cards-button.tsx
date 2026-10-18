"use client";

import { Button } from "@/components/ui/button";

// window.print() only exists in the browser, so this one piece is a client component; the rest of
// the report card page stays a server component (same split as the receipt's print button).
// "Save as PDF" in the browser's print dialog produces the PDF.
export function PrintReportCardsButton({ count }: { count: number }) {
  return (
    <Button size="sm" onClick={() => window.print()} className="print:hidden">
      {count > 1 ? `Print / Save as PDF (${count} report cards)` : "Print / Save as PDF"}
    </Button>
  );
}
