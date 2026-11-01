"use client";

import { useSchoolHref } from "@/components/app-shell/school-slug-context";

/** Shown on Reconciliation only for schools with paybill auto-capture switched on. */
export function PaybillLink() {
  const toHref = useSchoolHref();
  return (
    <div className="panel p-3 text-sm text-muted-foreground">
      Paybill payments are also captured automatically.{" "}
      <a href={toHref("/finance/paybill")} className="underline">
        See paybill auto-capture
      </a>
      .
    </div>
  );
}
