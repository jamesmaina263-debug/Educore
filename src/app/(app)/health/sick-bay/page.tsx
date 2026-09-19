import { loadHealthContext } from "../_data";
import { getSickBayPage } from "@/lib/health/get-sick-bay-page";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { SickBaySection } from "@/components/health/sick-bay-section";

const PAGE_SIZE = 25;

export default async function HealthSickBayPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { q, status, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const showHistory = status === "all";

  const [ctx, { rows, totalCount }] = await Promise.all([
    loadHealthContext(),
    getSickBayPage({ search: q, status: showHistory ? "all" : "open", page, pageSize: PAGE_SIZE }),
  ]);

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Health"
      moduleHref="/health/dashboard"
      section="Sick Bay"
      title="Sick Bay"
      noAccess={!(ctx.canReadAny || ctx.canWrite)}
    >
      <SickBaySection
        visits={rows}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        showHistory={showHistory}
        studentOptions={ctx.studentOptions}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
