import { loadInventoryContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { SupplierInvoicesPanel } from "@/components/inventory/procurement-section";

export default async function InventoryInvoicesPage() {
  const ctx = await loadInventoryContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Inventory & Procurement"
      moduleHref="/inventory/stock"
      section="Supplier Invoices"
      title="Supplier Invoices"
      noAccess={!ctx.canReadAny}
    >
      <SupplierInvoicesPanel invoices={ctx.invoices} suppliers={ctx.suppliers} purchaseOrders={ctx.purchaseOrders} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
