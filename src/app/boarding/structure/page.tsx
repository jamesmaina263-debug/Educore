import { loadBoardingContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { StructureSection } from "@/components/boarding/structure-section";

export default async function BoardingStructurePage() {
  const ctx = await loadBoardingContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Boarding"
      moduleHref="/boarding/dashboard"
      section="Structure"
      title="Structure"
    >
      <StructureSection houses={ctx.houseTree} staff={ctx.staffOptions} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
