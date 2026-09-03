import { loadPathwayGuidanceContext } from "./_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { PathwayGuidanceSection } from "@/components/academics/pathway-guidance-section";
import { PathwayGuidanceClassPicker } from "@/components/academics/pathway-guidance-class-picker";

export default async function PathwayGuidancePage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}) {
  const { class: classParam } = await searchParams;
  const ctx = await loadPathwayGuidanceContext(classParam);

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Academics"
      moduleHref="/academics/years-terms"
      section="Pathway Guidance"
      title="Senior School Pathway Guidance"
      subtitle="Advisory pathway-fit signal from recorded subject performance — never a requirement."
      noAccess={!ctx.canView}
    >
      {ctx.classOptions.length === 0 ? (
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          No classes configured yet — set these up under Classes &amp; Streams first.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <PathwayGuidanceClassPicker classOptions={ctx.classOptions} selectedClassId={ctx.selectedClassId} />
          <PathwayGuidanceSection roster={ctx.roster} />
        </div>
      )}
    </ModulePageShell>
  );
}
