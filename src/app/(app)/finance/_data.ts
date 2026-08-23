import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { FeeStructureRow } from "@/components/finance/fee-structures-section";
import type { InvoiceListRow } from "@/components/finance/invoices-section";
import type { BalanceRow } from "@/components/finance/balances-section";
import type { PaymentListRow } from "@/components/finance/payments-section";
import type { UnallocatedPaymentRow } from "@/components/finance/unallocated-payments-section";
import type { DiscountRow, InvoiceOption } from "@/components/finance/discounts-section";
import type { ExpenseRow } from "@/components/finance/expenses-section";
import type { FeeWaiverRow, StudentOption, TermOption } from "@/components/finance/waivers-section";

export interface FinanceContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  expenseApprovalThreshold: number | null;
  feeAlertThreshold: number | null;
  canRead: boolean;
  canWrite: boolean;
  canApproveDiscounts: boolean;
  canApproveExpenses: boolean;
  mpesaActive: boolean;
  activeYearId: string;
  activeTermName: string | null;
  terms: { id: string; name: string; status: string }[];
  classes: { id: string; name: string }[];
  structureRows: FeeStructureRow[];
  invoiceRows: InvoiceListRow[];
  invoiceOptions: InvoiceOption[];
  paymentRows: PaymentListRow[];
  unallocatedRows: UnallocatedPaymentRow[];
  discountRows: DiscountRow[];
  expenseRows: ExpenseRow[];
  waiverRows: FeeWaiverRow[];
  studentOptions: StudentOption[];
  termOptions: TermOption[];
  balanceRows: BalanceRow[];
  termInvoiced: number;
  termCollected: number;
  termDiscounted: number;
  termOutstanding: number;
}

/**
 * Single source of truth for every Finance subsection page. Loads auth + permissions +
 * all Finance data once, exactly as the pre-Phase-19 monolithic /finance page did — no
 * business logic changed, only where it lives.
 */
export async function loadFinanceContext(): Promise<FinanceContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canRead }, { data: canWrite }, { data: canApproveDiscounts }, { data: canApproveExpenses }, { data: mpesaSettings }] =
    await Promise.all([
      supabase
        .from("school_users")
        .select("full_name, roles(display_name), schools(name, expense_approval_threshold, fee_alert_threshold)")
        .eq("auth_user_id", user.id)
        .maybeSingle(),
      supabase.rpc("auth_has_permission", { p_permission_key: "finance.read" }),
      supabase.rpc("auth_has_permission", { p_permission_key: "finance.write" }),
      supabase.rpc("auth_has_permission", { p_permission_key: "discounts.approve" }),
      supabase.rpc("auth_has_permission", { p_permission_key: "expenses.approve" }),
      supabase.from("mpesa_settings").select("is_active").maybeSingle(),
    ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const school = schoolUser?.schools as unknown as { name: string; expense_approval_threshold: number | null; fee_alert_threshold: number | null } | null;

  const base = {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName: school?.name ?? "EduCore",
    expenseApprovalThreshold: school?.expense_approval_threshold ?? null,
    feeAlertThreshold: school?.fee_alert_threshold ?? null,
    canRead: canRead === true,
    canWrite: canWrite === true,
    canApproveDiscounts: canApproveDiscounts === true,
    canApproveExpenses: canApproveExpenses === true,
    mpesaActive: mpesaSettings?.is_active ?? false,
  };

  if (!canRead) {
    return {
      ...base,
      activeYearId: "",
      activeTermName: null,
      terms: [],
      classes: [],
      structureRows: [],
      invoiceRows: [],
      invoiceOptions: [],
      paymentRows: [],
      unallocatedRows: [],
      discountRows: [],
      expenseRows: [],
      waiverRows: [],
      studentOptions: [],
      termOptions: [],
      balanceRows: [],
      termInvoiced: 0,
      termCollected: 0,
      termDiscounted: 0,
      termOutstanding: 0,
    };
  }

  const [{ data: years }, { data: classes }, { data: structures }, { data: feeItems }, { data: invoices }, { data: payments }, { data: discounts }, { data: expenses }, { data: balances }, { data: allocations }, { data: waivers }, { data: activeStudents }, { data: accounts }, { data: receipts }, { data: reversals }] =
    await Promise.all([
      supabase.from("academic_years").select("id, status").eq("status", "active"),
      supabase.from("classes").select("id, name").order("level_order"),
      supabase.from("fee_structures").select("id, name, term_id, class_id, boarding_type, fee_category, is_active, terms(name), classes(name)").order("created_at", { ascending: false }),
      supabase.from("fee_items").select("fee_structure_id, name, amount"),
      supabase.from("invoices").select("id, student_id, total_amount, status, created_at, term_id, students(first_name, last_name, current_class_id, admission_number), terms(name)").order("created_at", { ascending: false }),
      supabase.from("payments").select("id, student_id, method, amount, reference, purpose, notes, status, phone_number, recorded_at, students(first_name, last_name)").order("recorded_at", { ascending: false }),
      supabase.from("discounts").select("id, invoice_id, amount, reason, status, students(first_name, last_name)").order("created_at", { ascending: false }),
      supabase.from("expenses").select("id, category, vendor, amount, description, status").order("created_at", { ascending: false }),
      supabase.from("v_student_balances").select("student_id, total_invoiced, total_discounted, total_paid, balance, credit_balance, stream_id"),
      supabase.from("payment_allocations").select("invoice_id, amount_allocated"),
      supabase
        .from("fee_waivers")
        .select("id, name, waiver_type, discount_kind, discount_value, status, students(first_name, last_name), starts_term:terms!fee_waivers_starts_term_id_fkey(name)")
        .order("created_at", { ascending: false }),
      supabase.from("students").select("id, first_name, last_name").eq("status", "active").order("first_name"),
      supabase.from("student_financial_accounts").select("student_id, payment_reference"),
      supabase.from("receipts").select("payment_id, receipt_number"),
      supabase.from("payment_reversals").select("payment_id, amount"),
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
      fee_category: s.fee_category as "core" | "transport",
      is_active: s.is_active,
      total: items.reduce((sum, i) => sum + Number(i.amount), 0),
      items: items.map((i) => ({ name: i.name, amount: Number(i.amount) })),
    };
  });

  const paidByInvoice = new Map<string, number>();
  for (const a of allocations ?? []) {
    paidByInvoice.set(a.invoice_id, (paidByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount_allocated));
  }
  const discountedByInvoice = new Map<string, number>();
  for (const d of discounts ?? []) {
    if (d.status === "approved" && d.invoice_id) {
      discountedByInvoice.set(d.invoice_id, (discountedByInvoice.get(d.invoice_id) ?? 0) + Number(d.amount));
    }
  }

  const invoiceRows: InvoiceListRow[] = (invoices ?? []).map((inv) => {
    const st = inv.students as unknown as { first_name: string; last_name: string; current_class_id: string } | null;
    return {
      id: inv.id,
      student_id: inv.student_id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      class_name: st ? classNameByStream.get(st.current_class_id) ?? "" : "",
      created_at: inv.created_at,
      total_amount: Number(inv.total_amount),
      paid: paidByInvoice.get(inv.id) ?? 0,
      discounted: discountedByInvoice.get(inv.id) ?? 0,
      status: inv.status as "unpaid" | "partially_paid" | "paid",
    };
  });

  const invoiceOptions: InvoiceOption[] = (invoices ?? [])
    .filter((inv) => inv.status !== "paid")
    .map((inv) => {
      const st = inv.students as unknown as { first_name: string; last_name: string } | null;
      return { id: inv.id, student_id: inv.student_id, student_name: st ? `${st.first_name} ${st.last_name}` : "", total_amount: Number(inv.total_amount) };
    });

  const receiptByPayment = new Map((receipts ?? []).map((r) => [r.payment_id, r.receipt_number]));
  const reversedByPayment = new Map<string, number>();
  for (const r of reversals ?? []) {
    reversedByPayment.set(r.payment_id, (reversedByPayment.get(r.payment_id) ?? 0) + Number(r.amount));
  }

  const paymentRows: PaymentListRow[] = (payments ?? [])
    .filter((p) => p.status !== "unallocated")
    .map((p) => {
      const st = p.students as unknown as { first_name: string; last_name: string } | null;
      return {
        id: p.id,
        student_name: st ? `${st.first_name} ${st.last_name}` : "",
        method: p.method as PaymentListRow["method"],
        amount: Number(p.amount),
        reference: p.reference,
        purpose: p.purpose,
        status: p.status as PaymentListRow["status"],
        receipt_number: receiptByPayment.get(p.id) ?? null,
        reversed_total: reversedByPayment.get(p.id) ?? 0,
        recorded_at: p.recorded_at,
      };
    });

  const unallocatedRows: UnallocatedPaymentRow[] = (payments ?? [])
    .filter((p) => p.status === "unallocated")
    .map((p) => ({
      id: p.id,
      method: p.method as UnallocatedPaymentRow["method"],
      amount: Number(p.amount),
      reference: p.reference,
      phone_number: p.phone_number,
      purpose: p.purpose,
      notes: p.notes,
      recorded_at: p.recorded_at,
    }));

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

  const studentNameByStreamMap = new Map<string, { name: string; class_name: string; admission_number: string }>();
  for (const inv of invoices ?? []) {
    const st = inv.students as unknown as { first_name: string; last_name: string; current_class_id: string; admission_number: string } | null;
    if (st)
      studentNameByStreamMap.set(inv.student_id, {
        name: `${st.first_name} ${st.last_name}`,
        class_name: classNameByStream.get(st.current_class_id) ?? "",
        admission_number: st.admission_number,
      });
  }

  const referenceByStudent = new Map((accounts ?? []).map((a) => [a.student_id, a.payment_reference]));

  const balanceRows: BalanceRow[] = (balances ?? [])
    .filter((b) => Number(b.total_invoiced) > 0)
    .map((b) => ({
      student_id: b.student_id,
      full_name: studentNameByStreamMap.get(b.student_id)?.name ?? "",
      admission_number: studentNameByStreamMap.get(b.student_id)?.admission_number ?? "",
      payment_reference: referenceByStudent.get(b.student_id) ?? null,
      class_name: classNameByStream.get(b.stream_id ?? "") ?? "",
      total_invoiced: Number(b.total_invoiced),
      total_discounted: Number(b.total_discounted),
      total_paid: Number(b.total_paid),
      balance: Number(b.balance),
      credit_balance: Number(b.credit_balance),
    }));

  const activeTerm = (terms ?? []).find((t) => t.status === "active") ?? null;
  const termInvoiceRows = activeTerm ? (invoices ?? []).filter((inv) => inv.term_id === activeTerm.id) : (invoices ?? []);
  const termInvoiced = termInvoiceRows.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
  const termCollected = termInvoiceRows.reduce((sum, inv) => sum + (paidByInvoice.get(inv.id) ?? 0), 0);
  const termDiscounted = termInvoiceRows.reduce((sum, inv) => sum + (discountedByInvoice.get(inv.id) ?? 0), 0);
  const termOutstanding = termInvoiced - termCollected - termDiscounted;

  return {
    ...base,
    activeYearId,
    activeTermName: activeTerm?.name ?? null,
    terms: (terms ?? []) as { id: string; name: string; status: string }[],
    classes: (classes ?? []) as { id: string; name: string }[],
    structureRows,
    invoiceRows,
    invoiceOptions,
    paymentRows,
    unallocatedRows,
    discountRows,
    expenseRows,
    waiverRows,
    studentOptions,
    termOptions,
    balanceRows,
    termInvoiced,
    termCollected,
    termDiscounted,
    termOutstanding,
  };
}

export function kes(n: number) {
  return `KES ${Math.round(n).toLocaleString()}`;
}
