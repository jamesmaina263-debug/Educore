import { loadCampusesContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { GroupBrandingForm } from "@/components/campuses/group-branding-form";

export default async function CampusesBrandingPage() {
  const ctx = await loadCampusesContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Campuses"
      moduleHref="/campuses/overview"
      section="Branding"
      title="Campuses"
    >
      {!ctx.isGroupAdmin ? (
        <p className="text-sm text-muted-foreground">
          This area is for Group Admin accounts managing multiple campuses. Your account isn&apos;t scoped to a school group.
        </p>
      ) : (
        ctx.brandingData && <GroupBrandingForm initial={ctx.brandingData} />
      )}
    </ModulePageShell>
  );
}
