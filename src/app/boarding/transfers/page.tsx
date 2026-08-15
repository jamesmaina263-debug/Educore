import { loadBoardingContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { TransfersSection } from "@/components/boarding/transfers-section";

export default async function BoardingTransfersPage() {
  const ctx = await loadBoardingContext();
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
        transfers={ctx.transferTableRows}
        boardingStudents={ctx.boardingStudentOptions}
        availableBeds={ctx.availableBeds}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
