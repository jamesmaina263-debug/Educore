import { loadInventoryContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { SuppliersPanel } from "@/components/inventory/procurement-section";

export default async function InventorySuppliersPage() {
  const ctx = await loadInventoryContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Inventory & Procurement"
      moduleHref="/inventory/stock"
      section="Suppliers"
      title="Suppliers"
      noAccess={!ctx.canReadAny}
    >
      <SuppliersPanel suppliers={ctx.suppliers} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
