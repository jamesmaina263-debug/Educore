"use client";

import { useSchoolHref } from "@/components/app-shell/school-slug-context";

/** Shown on the Finance dashboard only for schools with refunds switched on. */
export function RefundsLink() {
  const toHref = useSchoolHref();
  return (
    <div className="panel p-3 text-sm text-muted-foreground">
      Refunds are on for this school.{" "}
      <a href={toHref("/finance/refunds")} className="underline">
        Open refunds
      </a>
      .
    </div>
  );
}
