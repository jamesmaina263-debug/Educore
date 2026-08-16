import { loadAcademicsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { RolloverSection } from "@/components/academics/rollover-section";

export default async function RolloverPage() {
  const ctx = await loadAcademicsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Academics"
      moduleHref="/academics/years-terms"
      section="Rollover"
      title="Rollover"
      noAccess={!ctx.canRollover}
    >
      <RolloverSection years={ctx.years} students={ctx.students} />
    </ModulePageShell>
  );
}
