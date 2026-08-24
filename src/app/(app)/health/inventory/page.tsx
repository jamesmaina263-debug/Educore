import { loadHealthContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { InventorySection } from "@/components/health/inventory-section";

export default async function HealthInventoryPage() {
  const ctx = await loadHealthContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Health"
      moduleHref="/health/dashboard"
      section="Inventory"
      title="Inventory"
      noAccess={!(ctx.canReadAny || ctx.canWrite)}
    >
      <InventorySection
        items={ctx.medicalItems}
        medicalCategoryId={ctx.medicalCategoryId}
        pendingTransfers={ctx.pendingTransfers}
        canWrite={ctx.canWrite}
        canRequestSupplies={ctx.canRequestSupplies}
        myRequisitions={ctx.myRequisitions}
      />
    </ModulePageShell>
  );
}
