import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { loadPayrollContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { LoansSection, type DraftRecord, type EntryRow, type LoanRow } from "@/components/payroll/loans-section";
import { STAFF_LOANS_FLAG, type LoanKind, type LoanStatus } from "@/lib/staff-loans";

export default async function StaffLoansPage() {
  const ctx = await loadPayrollContext();
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has the flag (fails closed), and only for payroll staff.
  if (!(await hasFeatureFlag(supabase, STAFF_LOANS_FLAG))) notFound();
  if (!ctx.canReadAny) notFound();

  const [{ data: me }, { data: loanRows }, { data: balanceRows }, { data: entryRows }] = await Promise.all([
    supabase.from("school_users").select("id").eq("auth_user_id", user.id).maybeSingle(),
    supabase
      .from("staff_loans")
      .select("id, staff_id, kind, principal, installment, first_year, first_month, reason, status, agreement_on, created_by, created_at, closed_reason")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("staff_loan_balances").select("loan_id, repaid, balance").limit(1000),
    supabase
      .from("staff_loan_entries")
      .select("id, loan_id, kind, amount, period_year, period_month, note, created_at")
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  const names = new Map(ctx.staffOptions.map((s) => [s.id, s.full_name]));
  const balances = new Map((balanceRows ?? []).map((b) => [b.loan_id as string, { repaid: Number(b.repaid), balance: Number(b.balance) }]));
  const loans: LoanRow[] = (loanRows ?? []).map((l) => ({
    id: l.id as string,
    staffId: l.staff_id as string,
    staffName: names.get(l.staff_id as string) ?? "Staff member",
    kind: l.kind as LoanKind,
    principal: Number(l.principal),
    installment: Number(l.installment),
    firstYear: l.first_year as number,
    firstMonth: l.first_month as number,
    reason: (l.reason as string | null) ?? "",
    status: l.status as LoanStatus,
    agreementOn: (l.agreement_on as string | null) ?? null,
    createdByMe: !!me && l.created_by === me.id,
    isMine: !!me && l.staff_id === me.id,
    repaid: balances.get(l.id as string)?.repaid ?? 0,
    balance: balances.get(l.id as string)?.balance ?? Number(l.principal),
    closedReason: (l.closed_reason as string | null) ?? null,
  }));
  const entries: EntryRow[] = (entryRows ?? []).map((e) => ({
    id: e.id as string,
    loanId: e.loan_id as string,
    kind: e.kind as EntryRow["kind"],
    amount: Number(e.amount),
    periodYear: (e.period_year as number | null) ?? null,
    periodMonth: (e.period_month as number | null) ?? null,
    note: (e.note as string | null) ?? null,
    createdAt: e.created_at as string,
  }));
  const drafts: DraftRecord[] = ctx.records
    .filter((r) => r.status === "draft")
    .map((r) => ({ id: r.id, label: `${r.staff_name}, ${r.period_year}-${String(r.period_month).padStart(2, "0")}` }));

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Payroll"
      moduleHref="/payroll/runs"
      section="Staff loans"
      title="Staff loans and advances"
      subtitle="Record loans and salary advances, see what is still owed, and work out the instalment that can lawfully be deducted. Nothing here pays a loan out or changes a payslip."
    >
      <LoansSection
        loans={loans}
        entries={entries}
        staff={ctx.staffOptions.map((s) => ({ id: s.id, name: s.full_name }))}
        drafts={drafts}
        canWrite={ctx.canWrite}
        canApprove={ctx.canApprove}
        today={new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}
      />
    </ModulePageShell>
  );
}
