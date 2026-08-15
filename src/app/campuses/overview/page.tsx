import { loadCampusesContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { CampusSummaryTable } from "@/components/campuses/campus-summary-table";

export default async function CampusesOverviewPage() {
  const ctx = await loadCampusesContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Campuses"
      moduleHref="/campuses/overview"
      section="Overview"
      title="Campuses"
      subtitle="Cross-campus visibility, group branding, and group-level API access"
    >
      {!ctx.isGroupAdmin ? (
        <p className="text-sm text-muted-foreground">
          This area is for Group Admin accounts managing multiple campuses. Your account isn&apos;t scoped to a school group.
        </p>
      ) : (
        <CampusSummaryTable rows={ctx.summaryRows} />
      )}
    </ModulePageShell>
  );
}
