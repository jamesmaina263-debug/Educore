import { loadBoardingContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { IncidentsSection } from "@/components/boarding/incidents-section";

export default async function BoardingIncidentsPage() {
  const ctx = await loadBoardingContext();
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
      <IncidentsSection incidents={ctx.incidentTableRows} boardingStudents={ctx.boardingStudentOptions} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
