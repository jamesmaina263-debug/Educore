import { loadDisciplineContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { DisciplineWelfareSection } from "@/components/discipline/discipline-welfare-section";

export default async function DisciplineCasesPage() {
  const ctx = await loadDisciplineContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Discipline & Welfare"
      moduleHref="/discipline/incidents"
      section="Cases"
      title="Discipline & Welfare"
      subtitle={`Incidents, cases, welfare concerns${ctx.permissions.canSafeguardingRead ? ", and safeguarding" : ""}.`}
    >
      <DisciplineWelfareSection
        section="cases"
        permissions={ctx.permissions}
        students={ctx.students}
        staff={ctx.staff}
        actionTypes={ctx.actionTypes}
        incidents={ctx.incidents}
        cases={ctx.cases}
        welfare={ctx.welfare}
        safeguarding={ctx.safeguarding}
      />
    </ModulePageShell>
  );
}
