"use client";

import { useSchoolHref } from "@/components/app-shell/school-slug-context";

/** Shown on the Finance dashboard only for schools with the cashbook switched on. */
export function CashbookLink() {
  const toHref = useSchoolHref();
  return (
    <div className="panel p-3 text-sm text-muted-foreground">
      The cashbook is on for this school.{" "}
      <a href={toHref("/finance/cashbook")} className="underline">
        Open the cashbook
      </a>
      .
    </div>
  );
}
