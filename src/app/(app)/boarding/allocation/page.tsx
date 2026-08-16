import { loadBoardingContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { AllocationSection } from "@/components/boarding/allocation-section";

export default async function BoardingAllocationPage() {
  const ctx = await loadBoardingContext();
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
        allocations={ctx.allocationTableRows}
        studentOptions={ctx.studentOptions}
        availableBeds={ctx.availableBeds}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
