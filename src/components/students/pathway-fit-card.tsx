import { StatusBadge } from "@/components/status-badge";
import type { PathwayFitSummary } from "@/lib/academics/pathway-fit";

const PATHWAY_TONE: Record<string, "info" | "success" | "warning"> = {
  STEM: "info",
  "Social Sciences": "success",
  "Arts & Sports Science": "warning",
};

export function PathwayFitCard({ summary }: { summary: PathwayFitSummary }) {
  return (
    <div className="panel p-4">
      <p className="label-eyebrow">Senior School pathway fit</p>

      {summary.eligible ? (
        <>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {summary.pathways.map((p, i) => (
              <StatusBadge
                key={p.pathway}
                tone={PATHWAY_TONE[p.pathway] ?? "neutral"}
                label={`${i === 0 ? "Leading: " : ""}${p.pathway} ${p.averagePercent}%`}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Based on recorded Grade 9 subject performance — advisory only, not a requirement or gate.
            The learner may choose any pathway.
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          {summary.ineligibleReason ?? "Not enough recorded performance yet to show pathway guidance."}
        </p>
      )}
    </div>
  );
}
