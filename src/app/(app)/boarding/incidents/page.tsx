import { loadBoardingContext } from "../_data";
import { getIncidentsPage } from "@/lib/boarding/get-incidents-page";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { IncidentsSection } from "@/components/boarding/incidents-section";

const PAGE_SIZE = 25;

export default async function BoardingIncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [ctx, { rows, totalCount }] = await Promise.all([
    loadBoardingContext(),
    getIncidentsPage({ search: q, page, pageSize: PAGE_SIZE }),
  ]);

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Boarding"
      moduleHref="/boarding/dashboard"
      section="Incidents"
      title="Incidents"
    >
      <IncidentsSection
        incidents={rows}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        boardingStudents={ctx.boardingStudentOptions}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
