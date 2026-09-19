import { loadBoardingContext } from "../_data";
import { getTransfersPage } from "@/lib/boarding/get-transfers-page";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { TransfersSection } from "@/components/boarding/transfers-section";

const PAGE_SIZE = 25;

export default async function BoardingTransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [ctx, { rows, totalCount }] = await Promise.all([
    loadBoardingContext(),
    getTransfersPage({ search: q, page, pageSize: PAGE_SIZE }),
  ]);

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Boarding"
      moduleHref="/boarding/dashboard"
      section="Transfers"
      title="Transfers"
    >
      <TransfersSection
        transfers={rows}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        boardingStudents={ctx.boardingStudentOptions}
        availableBeds={ctx.availableBeds}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
