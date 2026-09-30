import { loadFinanceContext } from "../_data";
import { getStudentBalancesPage } from "@/lib/students/get-student-balances-page";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { BalancesSection } from "@/components/finance/balances-section";

const PAGE_SIZE = 25;

export default async function FinanceStudentAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; classId?: string; page?: string }>;
}) {
  const { q, classId, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [ctx, { rows, totalCount }] = await Promise.all([
    loadFinanceContext(),
    getStudentBalancesPage({ search: q, classId, page, pageSize: PAGE_SIZE }),
  ]);
  const activeTermId = ctx.terms.find((t) => t.status === "active")?.id ?? null;

  return (
    <FinancePageShell ctx={ctx} section="Student Accounts" title="Student Accounts">
      <BalancesSection
        rows={rows}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        classId={classId ?? ""}
        classOptions={ctx.classes}
        canWrite={ctx.canWrite}
        students={ctx.studentOptions}
        activeTermId={activeTermId}
        mpesaActive={ctx.mpesaActive}
      />
    </FinancePageShell>
  );
}
