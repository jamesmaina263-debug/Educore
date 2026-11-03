"use client";

import { useSchoolHref } from "@/components/app-shell/school-slug-context";

/** Shown on Transport only to staff who can manage vehicles, and only for schools with live tracking on. */
export function DriverCodesLink() {
  const toHref = useSchoolHref();
  return (
    <div className="panel p-3 text-sm text-muted-foreground">
      Live tracking is on for this school.{" "}
      <a href={toHref("/transport/devices")} className="underline">
        Manage driver codes
      </a>{" "}
      to let a driver&apos;s phone share a vehicle&apos;s location.
    </div>
  );
}
