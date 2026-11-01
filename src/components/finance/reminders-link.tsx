"use client";

import { useSchoolHref } from "@/components/app-shell/school-slug-context";

/** Shown on Fee Alerts only for schools with scheduled fee reminders switched on. */
export function RemindersLink() {
  const toHref = useSchoolHref();
  return (
    <div className="panel p-3 text-sm text-muted-foreground">
      Scheduled reminders are on for this school.{" "}
      <a href={toHref("/finance/reminders")} className="underline">
        Open Fee Reminders
      </a>
      .
    </div>
  );
}
