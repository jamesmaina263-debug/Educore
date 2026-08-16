import { loadLibraryContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { LibrarySection } from "@/components/library/library-section";

export default async function LibraryFinesPage() {
  const ctx = await loadLibraryContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Library"
      moduleHref="/library/catalogue"
      section="Fines"
      title="Library"
      noAccess={!ctx.canWrite}
    >
      <LibrarySection
        section="fines"
        items={ctx.items}
        loans={ctx.loans}
        studentOptions={ctx.studentOptions}
        staffOptions={ctx.staffOptions}
        shelfOptions={ctx.shelfOptions}
        reservations={ctx.reservations}
        fines={ctx.fines}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
