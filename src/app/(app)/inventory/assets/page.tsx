import { loadInventoryContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { AssetsPanel } from "@/components/inventory/procurement-section";

export default async function InventoryAssetsPage() {
  const ctx = await loadInventoryContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Inventory & Procurement"
      moduleHref="/inventory/stock"
      section="Assets"
      title="Assets"
      noAccess={!ctx.canReadAny}
    >
      <AssetsPanel assets={ctx.assets} maintenance={ctx.maintenance} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
