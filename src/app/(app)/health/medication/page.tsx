import { loadHealthContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { MedicationSection } from "@/components/health/medication-section";

export default async function HealthMedicationPage() {
  const ctx = await loadHealthContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Health"
      moduleHref="/health/dashboard"
      section="Medication"
      title="Medication"
      noAccess={!(ctx.canReadAny || ctx.canWrite)}
    >
      <MedicationSection
        administrations={ctx.medicationTableRows}
        studentOptions={ctx.studentOptions}
        inventoryOptions={ctx.inventoryOptions}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
