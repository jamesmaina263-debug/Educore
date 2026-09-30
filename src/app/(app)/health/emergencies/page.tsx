import { loadHealthContext } from "../_data";
import { getEmergenciesPage } from "@/lib/health/get-emergencies-page";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { EmergenciesSection } from "@/components/health/emergencies-section";

const PAGE_SIZE = 25;

export default async function HealthEmergenciesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [ctx, { rows, totalCount }] = await Promise.all([
    loadHealthContext(),
    getEmergenciesPage({ search: q, page, pageSize: PAGE_SIZE }),
  ]);

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Health"
      moduleHref="/health/dashboard"
      section="Emergencies"
      title="Emergencies"
      noAccess={!(ctx.canReadAny || ctx.canWrite)}
    >
      <EmergenciesSection
        emergencies={rows}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        studentOptions={ctx.studentOptions}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
