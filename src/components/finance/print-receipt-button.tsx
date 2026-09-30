"use client";

import { Button } from "@/components/ui/button";

// Deliberately tiny and separate from the (server-component) receipt page — window.print()
// only exists in the browser, so this one piece has to be a client component. Nothing else
// on the receipt page needs client-side JS.
export function PrintReceiptButton() {
  return (
    <Button size="sm" onClick={() => window.print()} className="print:hidden">
      Print receipt
    </Button>
  );
}
