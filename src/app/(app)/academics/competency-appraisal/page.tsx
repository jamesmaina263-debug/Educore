import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { CompetencyAppraisalFilters } from "@/components/academics/competency-appraisal-filters";
import { CompetencyAppraisalGrid } from "@/components/academics/competency-appraisal-grid";
import { loadCompetencyAppraisalContext } from "./_data";

export default async function CompetencyAppraisalPage({
  searchParams,
}: {
  searchParams: Promise<{ stream?: string; term?: string; indicator?: string }>;
}) {
  const { stream: streamParam, term: termParam, indicator: indicatorParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await loadCompetencyAppraisalContext(streamParam, termParam, indicatorParam);

  const selectedIndicatorName = ctx.indicatorOptions.find((i) => i.id === ctx.selectedIndicatorId)?.name;
  const selectedStreamLabel = ctx.streamOptions.find((s) => s.id === ctx.selectedStreamId)?.label;

  return (
    <AppShell
      breadcrumbs={[
        { label: ctx.schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Competency Appraisal" },
      ]}
      userName={ctx.userName}
      userRole={ctx.userRole}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Competency Appraisal</h1>
            <p className="text-sm text-muted-foreground">
              {selectedStreamLabel ? `${selectedStreamLabel} — ` : ""}
              {selectedIndicatorName ?? "Rate core competencies, values, and PCI areas"}
            </p>
          </div>
          {ctx.streamOptions.length > 0 && ctx.termOptions.length > 0 && ctx.indicatorOptions.length > 0 && ctx.selectedStreamId && ctx.selectedTermId && ctx.selectedIndicatorId && (
            <CompetencyAppraisalFilters
              streamOptions={ctx.streamOptions}
              termOptions={ctx.termOptions}
              indicatorOptions={ctx.indicatorOptions}
              selectedStreamId={ctx.selectedStreamId}
              selectedTermId={ctx.selectedTermId}
              selectedIndicatorId={ctx.selectedIndicatorId}
            />
          )}
        </div>

        {!ctx.canWrite && !ctx.canWriteAny ? (
          <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            You don&apos;t have permission to appraise competencies.
          </p>
        ) : ctx.streamOptions.length === 0 ? (
          <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            You don&apos;t have a class assigned to appraise.
          </p>
        ) : ctx.selectedStreamId && ctx.selectedTermId && ctx.selectedIndicatorId ? (
          <CompetencyAppraisalGrid
            indicatorId={ctx.selectedIndicatorId}
            termId={ctx.selectedTermId}
            termClosed={ctx.selectedTermStatus === "closed"}
            roster={ctx.roster}
            bandOptions={ctx.bandOptions}
            canWrite={ctx.canWrite || ctx.canWriteAny}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
