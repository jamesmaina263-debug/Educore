import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { BalancesSection } from "@/components/finance/balances-section";

export default async function FinanceStudentAccountsPage() {
  const ctx = await loadFinanceContext();
  const activeTermId = ctx.terms.find((t) => t.status === "active")?.id ?? null;
  return (
    <FinancePageShell ctx={ctx} section="Student Accounts" title="Student Accounts">
      <BalancesSection rows={ctx.balanceRows} canWrite={ctx.canWrite} students={ctx.studentOptions} activeTermId={activeTermId} />
    </FinancePageShell>
  );
}
