import { loadHealthContext } from "../_data";
import { getReferralsPage } from "@/lib/health/get-referrals-page";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ReferralsSection } from "@/components/health/referrals-section";

const PAGE_SIZE = 25;

export default async function HealthReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [ctx, { rows, totalCount }] = await Promise.all([
    loadHealthContext(),
    getReferralsPage({ search: q, page, pageSize: PAGE_SIZE }),
  ]);

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
      <ReferralsSection
        referrals={rows}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        studentOptions={ctx.studentOptions}
        canWrite={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
