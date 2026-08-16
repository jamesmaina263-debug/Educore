import { loadAcademicsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { SubjectsSection } from "@/components/academics/subjects-section";

export default async function SubjectsPage() {
  const ctx = await loadAcademicsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Academics"
      moduleHref="/academics/years-terms"
      section="Subjects"
      title="Subjects"
    >
      <SubjectsSection subjects={ctx.subjects} catalogue={ctx.catalogue} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
