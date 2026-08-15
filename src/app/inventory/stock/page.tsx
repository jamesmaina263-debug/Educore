import { loadInventoryContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { InventorySection } from "@/components/inventory/inventory-section";

export default async function InventoryStockPage() {
  const ctx = await loadInventoryContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Inventory & Procurement"
      moduleHref="/inventory/stock"
      section="Stock"
      title="Inventory & Procurement"
      subtitle="Stock, assets, suppliers, and the requisition-to-payment procurement chain."
      noAccess={!ctx.canReadAny}
    >
      <InventorySection items={ctx.items} categories={ctx.categories} movements={ctx.movements} transfers={ctx.transfers} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
