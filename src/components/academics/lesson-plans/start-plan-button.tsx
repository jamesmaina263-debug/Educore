"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSchoolHref } from "@/components/app-shell/school-slug-context";
import { startLessonPlanAction } from "@/app/(app)/academics/scheme-of-work/[id]/lesson-plans/actions";

/** Creates the plan (prefilled from the scheme row) if it does not exist, then opens it. */
export function StartPlanButton({ schemeId, entryId, hasPlan, canEdit }: { schemeId: string; entryId: string; hasPlan: boolean; canEdit: boolean }) {
  const router = useRouter();
  const toHref = useSchoolHref();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!hasPlan && !canEdit) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span>
      <button
        type="button"
        className="text-sm underline disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startLessonPlanAction(entryId);
            if ("error" in r) setError(r.error);
            else router.push(toHref(`/academics/scheme-of-work/${schemeId}/lesson-plans/${entryId}`));
          })
        }
      >
        {hasPlan ? "Open" : "Start plan"}
      </button>
      {error && <span role="alert" className="ml-2 text-xs text-destructive">{error}</span>}
    </span>
  );
}
