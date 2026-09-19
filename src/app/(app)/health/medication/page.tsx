import { loadHealthContext } from "../_data";
import { getMedicationPage } from "@/lib/health/get-medication-page";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { MedicationSection } from "@/components/health/medication-section";

const PAGE_SIZE = 25;

export default async function HealthMedicationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [ctx, { rows, totalCount }] = await Promise.all([
    loadHealthContext(),
    getMedicationPage({ search: q, page, pageSize: PAGE_SIZE }),
  ]);

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Health"
      moduleHref="/health/dashboard"
      section="Medication"
      title="Medication"
      noAccess={!(ctx.canReadAny || ctx.canWrite)}
    >
      <MedicationSection
        administrations={rows}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        studentOptions={ctx.studentOptions}
        inventoryOptions={ctx.inventoryOptions}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
