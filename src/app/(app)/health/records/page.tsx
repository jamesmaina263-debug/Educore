import { loadHealthContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { MedicalRecordsSection } from "@/components/health/medical-records-section";

export default async function HealthRecordsPage() {
  const ctx = await loadHealthContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Health"
      moduleHref="/health/dashboard"
      section="Medical Records"
      title="Medical Records"
      noAccess={!(ctx.canReadAny || ctx.canWrite)}
    >
      <MedicalRecordsSection rows={ctx.medicalRecordRows} />
    </ModulePageShell>
  );
}
