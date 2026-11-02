import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatementRaw } from "./student-statement";

// Reads everything a statement needs for one learner. Runs with the service role (the bot has no
// user session), so it is the caller's job to have already proved the guardian-student link (the
// route does, via the PIN-verified request). Nothing here writes.

type Row = Record<string, unknown>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export async function loadStatementRaw(admin: SupabaseClient, schoolId: string, studentId: string): Promise<StatementRaw | null> {
  const [{ data: school }, { data: student }, { data: term }, { data: balance }, { data: invoices }] = await Promise.all([
    admin.from("schools").select("name, address, phone, primary_color").eq("id", schoolId).maybeSingle(),
    admin
      .from("students")
      .select("id, first_name, last_name, other_names, admission_number, streams(name, classes(name))")
      .eq("id", studentId)
      .eq("school_id", schoolId)
      .maybeSingle(),
    admin
      .from("terms")
      .select("id, name, academic_years(name)")
      .eq("school_id", schoolId)
      .eq("status", "active")
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("v_student_balances").select("balance, credit_balance").eq("student_id", studentId).maybeSingle(),
    admin.from("invoices").select("id, invoice_number, term_id, total_amount, created_at").eq("student_id", studentId).eq("school_id", schoolId),
  ]);
  if (!school || !student || !balance) return null;

  const invoiceRows = (invoices ?? []) as Row[];
  const invoiceIds = invoiceRows.map((i) => i.id as string);
  const [{ data: discounts }, { data: allocations }] =
    invoiceIds.length === 0
      ? [{ data: [] as Row[] }, { data: [] as Row[] }]
      : await Promise.all([
          admin.from("discounts").select("invoice_id, amount").in("invoice_id", invoiceIds).eq("status", "approved"),
          admin
            .from("payment_allocations")
            .select("payment_id, invoice_id, amount_allocated, payments(recorded_at, created_at, method, reference)")
            .in("invoice_id", invoiceIds),
        ]);

  const stream = one(student.streams as unknown as { name: string; classes: { name: string } | { name: string }[] | null } | { name: string; classes: { name: string } | { name: string }[] | null }[] | null);
  const className = one(stream?.classes as { name: string } | { name: string }[] | null | undefined)?.name ?? "";
  const year = one(term?.academic_years as { name: string } | { name: string }[] | null | undefined);

  return {
    school: { name: school.name as string, address: (school.address as string | null) ?? null, phone: (school.phone as string | null) ?? null, primaryColor: (school.primary_color as string | null) ?? null },
    student: {
      fullName: [student.first_name, student.other_names, student.last_name].filter(Boolean).join(" "),
      admissionNumber: (student.admission_number as string | null) ?? null,
      classLabel: stream ? `${className} ${stream.name}`.trim() : "",
    },
    term: term ? { id: term.id as string, name: term.name as string, yearName: year?.name ?? null } : null,
    invoices: invoiceRows.map((i) => ({
      id: i.id as string,
      invoiceNumber: (i.invoice_number as string | null) ?? null,
      termId: (i.term_id as string | null) ?? null,
      totalAmount: num(i.total_amount),
      createdAt: i.created_at as string,
    })),
    discounts: ((discounts ?? []) as Row[]).map((d) => ({ invoiceId: d.invoice_id as string, amount: num(d.amount) })),
    allocations: ((allocations ?? []) as Row[]).map((a) => {
      const p = one(a.payments as { recorded_at: string | null; created_at: string; method: string | null; reference: string | null } | null);
      return {
        paymentId: a.payment_id as string,
        invoiceId: a.invoice_id as string,
        amount: num(a.amount_allocated),
        paidAt: p?.recorded_at ?? p?.created_at ?? new Date(0).toISOString(),
        method: p?.method ?? null,
        reference: p?.reference ?? null,
      };
    }),
    accountBalance: num(balance.balance),
    creditBalance: num(balance.credit_balance),
    generatedAt: new Date().toISOString(),
  };
}
