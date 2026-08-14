import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { BalancesSection } from "@/components/finance/balances-section";

export default async function FinanceStudentAccountsPage() {
  const ctx = await loadFinanceContext();
  return (
    <FinancePageShell ctx={ctx} section="Student Accounts" title="Student Accounts">
      <BalancesSection rows={ctx.balanceRows} canWrite={ctx.canWrite} />
    </FinancePageShell>
  );
}
