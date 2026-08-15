import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { BillingPanel } from "@/components/settings/billing-panel";

export default async function SettingsBillingPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Billing"
      title="Settings"
      noAccess={!ctx.billingData}
    >
      {ctx.billingData && <BillingPanel data={ctx.billingData} />}
    </ModulePageShell>
  );
}
