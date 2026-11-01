"use client";

import { useSchoolHref } from "@/components/app-shell/school-slug-context";

/** Shown on Reconciliation only for schools with paybill auto-capture switched on. */
export function PaybillLink({ attentionCount = 0 }: { attentionCount?: number }) {
  const toHref = useSchoolHref();
  return (
    <div className="panel p-3 text-sm text-muted-foreground">
      Paybill payments are also captured automatically.{" "}
      <a href={toHref("/finance/paybill")} className="underline">
        See paybill auto-capture
      </a>
      .
      {attentionCount > 0 && (
        <span className="ml-2 font-semibold text-foreground">
          {attentionCount} {attentionCount === 1 ? "payment needs" : "payments need"} attention.
        </span>
      )}
    </div>
  );
}
