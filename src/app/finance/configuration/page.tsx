import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { ExpensesSection } from "@/components/finance/expenses-section";
import { FeeAlertThresholdPanel } from "@/components/finance/fee-alert-threshold-panel";

export default async function FinanceConfigurationPage() {
  const ctx = await loadFinanceContext();
  return (
    <FinancePageShell ctx={ctx} section="Configuration" title="Configuration">
      <div className="flex flex-col gap-6">
        <div>
          <p className="mb-2 text-sm font-semibold">Expenses</p>
          <ExpensesSection
            expenses={ctx.expenseRows}
            approvalThreshold={ctx.expenseApprovalThreshold}
            canRaise={ctx.canWrite}
            canApprove={ctx.canApproveExpenses}
          />
        </div>

        <FeeAlertThresholdPanel initialThreshold={ctx.feeAlertThreshold} canWrite={ctx.canWrite} />

        <div className="panel p-4">
          <p className="mb-2 text-sm font-semibold">Fee Structure & Payment Settings</p>
          <p className="text-sm text-muted-foreground">
            Fee structures are managed under Finance &rarr; Fee Structures. Manual payment methods
            (M-Pesa, bank, cash, cheque, card, other) are fixed for this build — no external payment
            API is connected. Expense approval threshold: {ctx.expenseApprovalThreshold != null ? `KES ${ctx.expenseApprovalThreshold.toLocaleString()}` : "not set"}.
          </p>
        </div>
      </div>
    </FinancePageShell>
  );
}
