import { loadAcademicsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { TimetableSection } from "@/components/academics/timetable-section";

export default async function TimetablePage() {
  const ctx = await loadAcademicsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Academics"
      moduleHref="/academics/years-terms"
      section="Timetable"
      title="Timetable"
    >
      <TimetableSection
        streams={ctx.streams}
        classes={ctx.classes}
        subjects={ctx.subjects}
        teachers={ctx.teachers}
        slots={ctx.timetableSlots}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
