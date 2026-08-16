import { loadAcademicsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { TeacherAllocationSection } from "@/components/academics/teacher-allocation-section";

export default async function TeacherAllocationPage() {
  const ctx = await loadAcademicsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Academics"
      moduleHref="/academics/years-terms"
      section="Teacher Allocation"
      title="Teacher Allocation"
    >
      <TeacherAllocationSection
        classes={ctx.activeYearClasses}
        streams={ctx.streams}
        subjects={ctx.subjects}
        teachers={ctx.teachers}
        allocations={ctx.classSubjectRows}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
