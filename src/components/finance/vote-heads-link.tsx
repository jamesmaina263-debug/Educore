"use client";

import { useSchoolHref } from "@/components/app-shell/school-slug-context";

/** Shown on Finance Reports only for schools with vote heads switched on. */
export function VoteHeadsLink() {
  const toHref = useSchoolHref();
  return (
    <div className="panel p-3 text-sm text-muted-foreground">
      Vote heads are on for this school.{" "}
      <a href={toHref("/finance/vote-heads")} className="underline">
        Open the vote head ledger
      </a>
      .
    </div>
  );
}
