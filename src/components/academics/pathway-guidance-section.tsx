import { StatusBadge } from "@/components/status-badge";
import type { StudentPathwayFitRow } from "@/app/(app)/academics/pathway-guidance/_data";

const PATHWAY_TONE: Record<string, "info" | "success" | "warning"> = {
  STEM: "info",
  "Social Sciences": "success",
  "Arts & Sports Science": "warning",
};

export function PathwayGuidanceSection({ roster }: { roster: StudentPathwayFitRow[] }) {
  if (roster.length === 0) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        No active students in this class yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel border-info/25 bg-info-subtle p-3 text-xs text-info">
        Advisory only. This ranks pathways by each student&apos;s own recorded subject performance so
        far — it is never a requirement, gate, or guarantee, and a student may choose any pathway
        regardless of what&apos;s shown here.
      </div>

      <div className="panel divide-y divide-border">
        {roster.map((row) => (
          <div key={row.studentId} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{row.fullName}</p>
                <p className="text-xs text-muted-foreground">
                  {row.admissionNumber ?? "No admission number"}
                  {row.streamName ? ` · ${row.streamName}` : ""}
                </p>
              </div>

              {row.summary.eligible ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {row.summary.pathways.map((p, i) => (
                    <StatusBadge
                      key={p.pathway}
                      tone={PATHWAY_TONE[p.pathway] ?? "neutral"}
                      label={`${i === 0 ? "Leading: " : ""}${p.pathway} ${p.averagePercent}%`}
                    />
                  ))}
                </div>
              ) : (
                <StatusBadge tone="neutral" label={row.summary.ineligibleReason ?? "Not enough data yet"} />
              )}
            </div>

            {row.summary.eligible && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  Subject breakdown
                </summary>
                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  {row.summary.pathways.flatMap((p) =>
                    p.subjects.map((s) => (
                      <div key={s.subjectId} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">
                          {s.subjectName} <span className="text-[0.65rem]">({p.pathway})</span>
                        </dt>
                        <dd className="font-medium">
                          {s.percent}% <span className="text-muted-foreground">· {s.markCount} exam(s)</span>
                        </dd>
                      </div>
                    )),
                  )}
                </dl>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
