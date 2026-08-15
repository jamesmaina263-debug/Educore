import { loadAcademicsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ClassesStreamsSection } from "@/components/academics/classes-streams-section";

export default async function ClassesStreamsPage() {
  const ctx = await loadAcademicsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Academics"
      moduleHref="/academics/years-terms"
      section="Classes & Streams"
      title="Classes & Streams"
    >
      <ClassesStreamsSection
        activeYearId={ctx.activeYearId}
        activeYearName={ctx.activeYearName}
        classes={ctx.activeYearClasses}
        streams={ctx.streams}
        occupancyByStream={ctx.occupancyByStream}
        teachers={ctx.teachers}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
