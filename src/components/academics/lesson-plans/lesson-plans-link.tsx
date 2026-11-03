"use client";

import { useSchoolHref } from "@/components/app-shell/school-slug-context";

/** Shown on a scheme of work only for schools with lesson plans switched on. */
export function LessonPlansLink({ schemeId }: { schemeId: string }) {
  const toHref = useSchoolHref();
  return (
    <div className="panel p-3 text-sm text-muted-foreground">
      Lesson plans are on for this school.{" "}
      <a href={toHref(`/academics/scheme-of-work/${schemeId}/lesson-plans`)} className="underline">
        Open lesson plans for this scheme
      </a>
      .
    </div>
  );
}
