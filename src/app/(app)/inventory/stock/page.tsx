import Link from "next/link";
import { loadInventoryContext } from "../_data";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { getSchoolSlug } from "@/lib/school-slug-server";
import { withSchoolSlug } from "@/lib/school-slug-href";
import { CANTEEN_FLAG } from "@/lib/canteen";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { InventorySection } from "@/components/inventory/inventory-section";

export default async function InventoryStockPage() {
  const ctx = await loadInventoryContext();
  // Link appears only in schools with the canteen switched on (fails closed).
  const showCanteen = await hasFeatureFlag(await createClient(), CANTEEN_FLAG);
  const schoolSlug = showCanteen ? await getSchoolSlug() : undefined;
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
      {showCanteen && (
        <p className="mb-3 text-sm">
          <Link className="text-primary hover:underline" href={withSchoolSlug(schoolSlug, "/inventory/canteen")}>
            Canteen: till, price list and student wallets
          </Link>
        </p>
      )}
      <InventorySection items={ctx.items} categories={ctx.categories} movements={ctx.movements} transfers={ctx.transfers} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
