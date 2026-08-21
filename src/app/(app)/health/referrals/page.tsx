import { loadHealthContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ReferralsSection } from "@/components/health/referrals-section";

export default async function HealthReferralsPage() {
  const ctx = await loadHealthContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Health"
      moduleHref="/health/dashboard"
      section="Referrals"
      title="Referrals"
      noAccess={!(ctx.canReadAny || ctx.canWrite)}
    >
      <ReferralsSection referrals={ctx.referralTableRows} studentOptions={ctx.studentOptions} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
