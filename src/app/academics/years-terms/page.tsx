import { loadAcademicsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { YearsTermsSection } from "@/components/academics/years-terms-section";

export default async function YearsTermsPage() {
  const ctx = await loadAcademicsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Academics"
      moduleHref="/academics/years-terms"
      section="Years & Terms"
      title="Years & Terms"
    >
      <YearsTermsSection years={ctx.years} terms={ctx.terms} canWrite={ctx.canWrite} canSendNewsletter={ctx.canSendNewsletter} />
    </ModulePageShell>
  );
}
