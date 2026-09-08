import type { ReportCardInsights } from "@/lib/academics/report-card-insights";

/**
 * Report-card redesign (Performance Appraisal Engine directive, Phase 14 /
 * roadmap Step 10). Shared between the parent portal's "Latest result" panel
 * and the staff-facing report-card review list, so both show the same
 * achievement-distribution bars and Strengths/Areas for Support lists built
 * by buildReportCardInsights() -- one source of truth for what a report card
 * highlights, per the directive's own "do not create competing calculation
 * logic in multiple UI components" principle (Phase 11), applied here to
 * display logic too.
 *
 * Achievement distribution is shown ahead of class rank/average deliberately
 * -- the directive is explicit that traditional class-position ranking
 * should not be "the central performance representation." Rank/average
 * still renders (schools may still want it), just secondary and smaller.
 */
export function ReportCardInsightsPanel({ insights }: { insights: ReportCardInsights }) {
  const { achievementDistribution, strengths, areasForSupport } = insights;
  const maxCount = Math.max(1, ...achievementDistribution.map((b) => b.count));

  if (achievementDistribution.length === 0 && strengths.length === 0 && areasForSupport.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {achievementDistribution.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Achievement distribution</p>
          <div className="flex flex-col gap-1">
            {achievementDistribution.map((b) => (
              <div key={b.label} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 font-medium">{b.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(b.count / maxCount) * 100}%` }} />
                </div>
                <span className="w-4 shrink-0 text-right text-muted-foreground">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(strengths.length > 0 || areasForSupport.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {strengths.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-success">Strengths</p>
              <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                {strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {areasForSupport.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-warning">Areas for support</p>
              <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                {areasForSupport.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
