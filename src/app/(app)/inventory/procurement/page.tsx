import { loadInventoryContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ProcurementPanel } from "@/components/inventory/procurement-section";

export default async function InventoryProcurementPage() {
  const ctx = await loadInventoryContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Inventory & Procurement"
      moduleHref="/inventory/stock"
      section="Procurement"
      title="Procurement"
      noAccess={!ctx.canReadAny}
    >
      <ProcurementPanel
        requisitions={ctx.requisitions}
        purchaseOrders={ctx.purchaseOrders}
        suppliers={ctx.suppliers}
        items={ctx.items}
        canWrite={ctx.canWrite}
        canApprove={ctx.canApprove}
        healthStockRequests={ctx.healthStockRequests}
      />
    </ModulePageShell>
  );
}
