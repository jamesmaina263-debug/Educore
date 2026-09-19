import { loadBoardingContext } from "../_data";
import { getAllocationsPage } from "@/lib/boarding/get-allocations-page";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { AllocationSection } from "@/components/boarding/allocation-section";

const PAGE_SIZE = 25;

export default async function BoardingAllocationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { q, status, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const showHistory = status === "all";

  const [ctx, { rows, totalCount }] = await Promise.all([
    loadBoardingContext(),
    getAllocationsPage({ search: q, status: showHistory ? "all" : "active", page, pageSize: PAGE_SIZE }),
  ]);

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Boarding"
      moduleHref="/boarding/dashboard"
      section="Allocation"
      title="Allocation"
    >
      <AllocationSection
        allocations={rows}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        showHistory={showHistory}
        studentOptions={ctx.studentOptions}
        availableBeds={ctx.availableBeds}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
