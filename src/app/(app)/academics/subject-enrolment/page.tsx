import { loadSubjectEnrolmentContext } from "./_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { PathwayGuidanceClassPicker } from "@/components/academics/pathway-guidance-class-picker";
import { SubjectEnrolmentSection } from "@/components/academics/subject-enrolment-section";

export default async function SubjectEnrolmentPage({ searchParams }: { searchParams: Promise<{ class?: string }> }) {
  const { class: classParam } = await searchParams;
  const ctx = await loadSubjectEnrolmentContext(classParam);

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Academics"
      moduleHref="/academics/years-terms"
      section="Subject Enrolment"
      title="Subject Enrolment"
      subtitle="Choose which students take each subject. A subject nobody has been chosen for is taken by everyone."
      noAccess={!ctx.canView}
    >
      {ctx.classOptions.length === 0 ? (
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          No classes configured yet — set these up under Classes &amp; Streams first.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <PathwayGuidanceClassPicker classOptions={ctx.classOptions} selectedClassId={ctx.selectedClassId} basePath="/academics/subject-enrolment" />
          <SubjectEnrolmentSection
            key={ctx.selectedClassId}
            classId={ctx.selectedClassId!}
            students={ctx.students}
            subjects={ctx.subjects}
            canEdit={ctx.canEdit}
          />
        </div>
      )}
    </ModulePageShell>
  );
}
