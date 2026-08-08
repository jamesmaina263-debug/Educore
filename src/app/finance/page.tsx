import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FeeStructuresSection, type FeeStructureRow } from "@/components/finance/fee-structures-section";
import { InvoicesSection, type InvoiceListRow } from "@/components/finance/invoices-section";
import { BalancesSection, type BalanceRow } from "@/components/finance/balances-section";
import { PaymentsSection, type PaymentListRow } from "@/components/finance/payments-section";
import { DiscountsSection, type DiscountRow, type InvoiceOption } from "@/components/finance/discounts-section";
import { ExpensesSection, type ExpenseRow } from "@/components/finance/expenses-section";
import { WaiversSection, type FeeWaiverRow, type StudentOption, type TermOption } from "@/components/finance/waivers-section";

export default async function FinancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canRead }, { data: canWrite }, { data: canApproveDiscounts }, { data: canApproveExpenses }] =
    await Promise.all([
      supabase
        .from("school_users")
        .select("full_name, roles(display_name), schools(name, expense_approval_threshold)")
        .eq("auth_user_id", user.id)
        .maybeSingle(),
      supabase.rpc("auth_has_permission", { p_permission_key: "finance.read" }),
      supabase.rpc("auth_has_permission", { p_permission_key: "finance.write" }),
      supabase.rpc("auth_has_permission", { p_permission_key: "discounts.approve" }),
      supabase.rpc("auth_has_permission", { p_permission_key: "expenses.approve" }),
    ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const school = schoolUser?.schools as unknown as { name: string; expense_approval_threshold: number | null } | null;

  if (!canRead) {
    return (
      <AppShell
        breadcrumbs={[{ label: school?.name ?? "EduCore", href: "/dashboard" }, { label: "Finance" }]}
        userName={schoolUser?.full_name ?? user.email ?? "Account"}
        userRole={roleName}
        onSignOut={logout}
      >
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          You don&apos;t have access to Finance.
        </div>
      </AppShell>
    );
  }

  const [{ data: years }, { data: classes }, { data: structures }, { data: feeItems }, { data: invoices }, { data: payments }, { data: discounts }, { data: expenses }, { data: balances }, { data: waivers }, { data: activeStudents }] =
    await Promise.all([
      supabase.from("academic_years").select("id, status").eq("status", "active"),
      supabase.from("classes").select("id, name").order("level_order"),
      supabase.from("fee_structures").select("id, name, term_id, class_id, boarding_type, is_active, terms(name), classes(name)").order("created_at", { ascending: false }),
      supabase.from("fee_items").select("fee_structure_id, name, amount"),
      supabase.from("invoices").select("id, student_id, total_amount, status, students(first_name, last_name, current_class_id), terms(name)").order("created_at", { ascending: false }),
      supabase.from("payments").select("id, student_id, method, amount, reference, recorded_at, students(first_name, last_name)").order("recorded_at", { ascending: false }),
      supabase.from("discounts").select("id, invoice_id, amount, reason, status, students(first_name, last_name)").order("created_at", { ascending: false }),
      supabase.from("expenses").select("id, category, vendor, amount, description, status").order("created_at", { ascending: false }),
      supabase.from("v_student_balances").select("student_id, total_invoiced, total_discounted, total_paid, balance, stream_id"),
      supabase
        .from("fee_waivers")
        .select("id, name, waiver_type, discount_kind, discount_value, status, students(first_name, last_name), starts_term:terms!fee_waivers_starts_term_id_fkey(name)")
        .order("created_at", { ascending: false }),
      supabase.from("students").select("id, first_name, last_name").eq("status", "active").order("first_name"),
    ]);

  const activeYearId = years?.[0]?.id ?? "";
  const { data: terms } = activeYearId
    ? await supabase.from("terms").select("id, name, status").eq("academic_year_id", activeYearId)
    : { data: [] };

  const { data: streamsWithClass } = await supabase.from("streams").select("id, class_id, classes(name)");
  const classNameByStream = new Map(
    (streamsWithClass ?? []).map((s) => [s.id, (s.classes as unknown as { name: string } | null)?.name ?? ""]),
  );

  const structureRows: FeeStructureRow[] = (structures ?? []).map((s) => {
    const items = (feeItems ?? []).filter((i) => i.fee_structure_id === s.id);
    return {
      id: s.id,
      name: s.name,
      term_id: s.term_id,
      term_name: (s.terms as unknown as { name: string } | null)?.name ?? "",
      class_id: s.class_id,
      class_name: (s.classes as unknown as { name: string } | null)?.name ?? null,
      boarding_type: s.boarding_type as "day" | "boarder",
      is_active: s.is_active,
      total: items.reduce((sum, i) => sum + Number(i.amount), 0),
      items: items.map((i) => ({ name: i.name, amount: Number(i.amount) })),
    };
  });

  const invoiceRows: InvoiceListRow[] = (invoices ?? []).map((inv) => {
    const st = inv.students as unknown as { first_name: string; last_name: string; current_class_id: string } | null;
    return {
      id: inv.id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      class_name: st ? classNameByStream.get(st.current_class_id) ?? "" : "",
      term_name: (inv.terms as unknown as { name: string } | null)?.name ?? "",
      total_amount: Number(inv.total_amount),
      status: inv.status as "unpaid" | "partially_paid" | "paid",
    };
  });

  const invoiceOptions: InvoiceOption[] = (invoices ?? [])
    .filter((inv) => inv.status !== "paid")
    .map((inv) => {
      const st = inv.students as unknown as { first_name: string; last_name: string } | null;
      return { id: inv.id, student_id: inv.student_id, student_name: st ? `${st.first_name} ${st.last_name}` : "", total_amount: Number(inv.total_amount) };
    });

  const paymentRows: PaymentListRow[] = (payments ?? []).map((p) => {
    const st = p.students as unknown as { first_name: string; last_name: string } | null;
    return {
      id: p.id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      method: p.method as "mpesa" | "cash" | "bank" | "cheque",
      amount: Number(p.amount),
      reference: p.reference,
      recorded_at: p.recorded_at,
    };
  });

  const discountRows: DiscountRow[] = (discounts ?? []).map((d) => {
    const st = d.students as unknown as { first_name: string; last_name: string } | null;
    return {
      id: d.id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      invoice_id: d.invoice_id,
      amount: Number(d.amount),
      reason: d.reason,
      status: d.status as "pending" | "approved" | "rejected",
    };
  });

  const expenseRows: ExpenseRow[] = (expenses ?? []).map((e) => ({
    id: e.id,
    category: e.category,
    vendor: e.vendor,
    amount: Number(e.amount),
    description: e.description,
    status: e.status as "pending" | "approved" | "rejected",
  }));

  const waiverRows: FeeWaiverRow[] = (waivers ?? []).map((w) => {
    const st = w.students as unknown as { first_name: string; last_name: string } | null;
    const startsTerm = w.starts_term as unknown as { name: string } | null;
    return {
      id: w.id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      name: w.name,
      waiver_type: w.waiver_type,
      discount_kind: w.discount_kind as "percentage" | "fixed_amount",
      discount_value: Number(w.discount_value),
      status: w.status as "active" | "expired" | "revoked",
      starts_term_name: startsTerm?.name ?? null,
      ends_term_name: null,
    };
  });

  const studentOptions: StudentOption[] = (activeStudents ?? []).map((s) => ({
    id: s.id,
    name: `${s.first_name} ${s.last_name}`,
  }));

  const termOptions: TermOption[] = (terms ?? []).map((t) => ({ id: t.id, name: t.name }));

  const studentNameByStreamMap = new Map<string, { name: string; class_name: string }>();
  for (const inv of invoices ?? []) {
    const st = inv.students as unknown as { first_name: string; last_name: string; current_class_id: string } | null;
    if (st) studentNameByStreamMap.set(inv.student_id, { name: `${st.first_name} ${st.last_name}`, class_name: classNameByStream.get(st.current_class_id) ?? "" });
  }

  const balanceRows: BalanceRow[] = (balances ?? [])
    .filter((b) => Number(b.total_invoiced) > 0)
    .map((b) => ({
      student_id: b.student_id,
      full_name: studentNameByStreamMap.get(b.student_id)?.name ?? "",
      class_name: classNameByStream.get(b.stream_id ?? "") ?? "",
      total_invoiced: Number(b.total_invoiced),
      total_discounted: Number(b.total_discounted),
      total_paid: Number(b.total_paid),
      balance: Number(b.balance),
    }));

  const totalInvoiced = balanceRows.reduce((sum, b) => sum + b.total_invoiced, 0);
  const totalCollected = balanceRows.reduce((sum, b) => sum + b.total_paid, 0);
  const totalOutstanding = balanceRows.reduce((sum, b) => sum + b.balance, 0);
  const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

  return (
    <AppShell
      breadcrumbs={[{ label: school?.name ?? "EduCore", href: "/dashboard" }, { label: "Finance" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Finance</h1>
          <p className="text-sm text-muted-foreground">Fee structures, invoices, payments, balances, discounts and expenses</p>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          <div className="panel px-4 py-3">
            <p className="label-eyebrow">Invoiced</p>
            <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>
              {kes(totalInvoiced)}
            </p>
          </div>
          <div className="panel px-4 py-3">
            <p className="label-eyebrow">Collected</p>
            <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>
              {kes(totalCollected)}
            </p>
          </div>
          <div className="panel px-4 py-3">
            <p className="label-eyebrow">Outstanding</p>
            <p className="mt-1 text-xl font-semibold tracking-tight text-destructive" data-numeric>
              {kes(totalOutstanding)}
            </p>
          </div>
        </div>

        <Tabs defaultValue="balances">
          <TabsList>
            <TabsTrigger value="balances">Balances</TabsTrigger>
            <TabsTrigger value="fee-structures">Fee Structures</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="discounts">Discounts</TabsTrigger>
            <TabsTrigger value="waivers">Waivers</TabsTrigger>
            <TabsTrigger value="expenses">Expenses</TabsTrigger>
          </TabsList>

          <TabsContent value="balances">
            <BalancesSection rows={balanceRows} canWrite={canWrite === true} />
          </TabsContent>

          <TabsContent value="fee-structures">
            <FeeStructuresSection
              structures={structureRows}
              academicYearId={activeYearId}
              terms={(terms ?? []).map((t) => ({ id: t.id, name: t.name }))}
              classes={(classes ?? []) as { id: string; name: string }[]}
              canWrite={canWrite === true}
            />
          </TabsContent>

          <TabsContent value="invoices">
            <InvoicesSection invoices={invoiceRows} />
          </TabsContent>

          <TabsContent value="payments">
            <PaymentsSection payments={paymentRows} />
          </TabsContent>

          <TabsContent value="discounts">
            <DiscountsSection
              discounts={discountRows}
              invoiceOptions={invoiceOptions}
              canRequest={canWrite === true}
              canApprove={canApproveDiscounts === true}
            />
          </TabsContent>

          <TabsContent value="waivers">
            <WaiversSection
              waivers={waiverRows}
              students={studentOptions}
              terms={termOptions}
              canManage={canApproveDiscounts === true}
            />
          </TabsContent>

          <TabsContent value="expenses">
            <ExpensesSection
              expenses={expenseRows}
              approvalThreshold={school?.expense_approval_threshold ?? null}
              canRaise={canWrite === true}
              canApprove={canApproveExpenses === true}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
