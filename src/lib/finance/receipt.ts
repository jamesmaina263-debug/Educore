import type { createClient } from "@/lib/supabase/server";

export interface PaymentReceiptData {
  receiptNumber: string;
  issuedAt: string;
  amount: number;
  method: string;
  reference: string | null;
  purpose: string | null;
  recordedAt: string;
  recordedByName: string | null;
  reversedTotal: number;
  balance: number;
  student: {
    fullName: string;
    admissionNumber: string | null;
    classLabel: string;
  };
  school: {
    name: string;
    logoUrl: string | null;
    primaryColor: string | null;
    address: string | null;
    phone: string | null;
  };
}

/**
 * Loads everything a payment receipt needs to render, for a given payment id. Access is
 * enforced entirely by the existing RLS policies on `receipts`/`payments`/`students`/`schools`
 * (finance staff with finance.read, the student's guardian, or the student themselves) — this
 * function adds no permission logic of its own, so it's safe to call from any authenticated
 * context (staff Finance pages, the parent portal) and RLS will simply return no row for a
 * payment/receipt the caller isn't allowed to see. Returns null when there's no receipt for
 * this payment (not yet issued, e.g. still unallocated) or the caller can't see it — callers
 * should treat both cases identically (404), never distinguish them, to avoid leaking which
 * one applies.
 */
export async function getPaymentReceipt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paymentId: string,
): Promise<PaymentReceiptData | null> {
  const { data: receipt } = await supabase
    .from("receipts")
    .select(
      "receipt_number, issued_at, student_id, payments(method, amount, reference, purpose, recorded_at, school_users(full_name)), students(first_name, last_name, other_names, admission_number, streams(name, classes(name))), schools(name, logo_url, primary_color, address, phone)",
    )
    .eq("payment_id", paymentId)
    .maybeSingle();

  if (!receipt) return null;

  const payment = receipt.payments as unknown as {
    method: string;
    amount: number;
    reference: string | null;
    purpose: string | null;
    recorded_at: string;
    school_users: { full_name: string } | null;
  } | null;
  const student = receipt.students as unknown as {
    first_name: string;
    last_name: string;
    other_names: string | null;
    admission_number: string | null;
    streams: { name: string; classes: { name: string } | null } | null;
  } | null;
  const school = receipt.schools as unknown as {
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    address: string | null;
    phone: string | null;
  } | null;

  if (!payment || !student) return null;

  // Best-effort context only, mirrors the reversed_total display already on the Finance >
  // Payments table — a failed/empty lookup here just shows no reversal note, never blocks
  // rendering the receipt itself.
  const { data: reversals } = await supabase.from("payment_reversals").select("amount").eq("payment_id", paymentId);
  const reversedTotal = (reversals ?? []).reduce((sum, r) => sum + Number(r.amount), 0);

  // Current balance, same computed-on-read view the Finance > Student Accounts table reads
  // (v_student_balances, security_invoker=true — RLS-safe for both staff and the parent portal).
  // This is the student's balance as of now, not a point-in-time snapshot as of this payment.
  const { data: balanceRow } = await supabase
    .from("v_student_balances")
    .select("balance")
    .eq("student_id", receipt.student_id)
    .maybeSingle();
  const balance = Number(balanceRow?.balance ?? 0);

  const fullName = [student.first_name, student.other_names, student.last_name].filter(Boolean).join(" ");
  const classLabel = student.streams ? `${student.streams.classes?.name ?? ""} ${student.streams.name}`.trim() : "—";

  return {
    receiptNumber: receipt.receipt_number,
    issuedAt: receipt.issued_at,
    amount: Number(payment.amount),
    method: payment.method,
    reference: payment.reference,
    purpose: payment.purpose,
    recordedAt: payment.recorded_at,
    recordedByName: payment.school_users?.full_name ?? null,
    reversedTotal,
    balance,
    student: {
      fullName,
      admissionNumber: student.admission_number,
      classLabel,
    },
    school: {
      name: school?.name ?? "EduCore School",
      logoUrl: school?.logo_url ?? null,
      primaryColor: school?.primary_color ?? null,
      address: school?.address ?? null,
      phone: school?.phone ?? null,
    },
  };
}
