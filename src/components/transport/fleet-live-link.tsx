"use client";

import { useSchoolHref } from "@/components/app-shell/school-slug-context";

/** Shown on Transport only to staff who can read transport data, and only for schools with live tracking on. */
export function FleetLiveLink() {
  const toHref = useSchoolHref();
  return (
    <div className="panel p-3 text-sm text-muted-foreground">
      Live tracking is on for this school.{" "}
      <a href={toHref("/transport/live")} className="underline">
        See where the vehicles are now
      </a>
      .
    </div>
  );
}
