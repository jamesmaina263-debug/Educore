import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { RefundsSection, type RefundCandidate, type RefundRow } from "@/components/finance/refunds-section";
import { REFUNDS_FLAG, REFUND_APPROVE_PERMISSION, methodLabel } from "@/lib/refunds";

type Maybe<T> = T | T[] | null | undefined;
const one = <T,>(v: Maybe<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { dateStyle: "medium" });
const fullName = (s: { first_name?: string | null; last_name?: string | null } | null) =>
  [s?.first_name, s?.last_name].filter(Boolean).join(" ") || "Unknown learner";

interface RequestRow {
  id: string;
  amount: number | string;
  status: string;
  reason_code: string;
  reason_note: string | null;
  requested_at: string;
  decision_note: string | null;
  student: Maybe<{ first_name: string | null; last_name: string | null; admission_number: string | null }>;
  payment: Maybe<{ method: string; reference: string | null; recorded_at: string; amount: number | string }>;
  requester: Maybe<{ full_name: string | null }>;
  decider: Maybe<{ full_name: string | null }>;
  payout: Maybe<{ method: string; reference: string; paid_at: string; paid_by_user: Maybe<{ full_name: string | null }> }>;
}

export default async function RefundsPage() {
  const supabase = await createClient();

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, REFUNDS_FLAG))) notFound();

  const ctx = await loadFinanceContext([]);

  let rows: RefundRow[] = [];
  let candidates: RefundCandidate[] = [];
  let canApprove = false;

  if (ctx.canRead) {
    const { data: approveData } = await supabase.rpc("auth_has_permission", { p_permission_key: REFUND_APPROVE_PERMISSION });
    canApprove = approveData === true;

    const { data: reqData, error: reqError } = await supabase
      .from("refund_requests")
      .select(
        "id, amount, status, reason_code, reason_note, requested_at, decision_note, " +
          "student:students(first_name, last_name, admission_number), " +
          "payment:payments(method, reference, recorded_at, amount), " +
          "requester:school_users!refund_requests_requested_by_fkey(full_name), " +
          "decider:school_users!refund_requests_decided_by_fkey(full_name), " +
          "payout:refund_payouts(method, reference, paid_at, paid_by_user:school_users!refund_payouts_paid_by_fkey(full_name))",
      )
      .order("requested_at", { ascending: false })
      .limit(200);
    if (reqError) {
      console.error("[refunds] requests failed", reqError);
      throw new Error("Failed to load refunds. Please try again.");
    }

    rows = ((reqData ?? []) as unknown as RequestRow[]).map((r) => {
      const student = one(r.student);
      const payment = one(r.payment);
      const payout = one(r.payout);
      return {
        id: r.id,
        amount: Number(r.amount),
        status: r.status,
        reasonCode: r.reason_code,
        reasonNote: r.reason_note,
        requestedAt: r.requested_at,
        requestedBy: one(r.requester)?.full_name ?? null,
        decidedBy: one(r.decider)?.full_name ?? null,
        decisionNote: r.decision_note,
        studentName: fullName(student),
        admissionNumber: student?.admission_number ?? null,
        paymentLabel: payment ? `${methodLabel(payment.method)} ${payment.reference ?? ""} of ${kes(Number(payment.amount))} on ${day(payment.recorded_at)}`.replace(/\s+/g, " ") : "a payment",
        payout: payout
          ? { method: payout.method, reference: payout.reference, paidAt: payout.paid_at, paidBy: one(payout.paid_by_user)?.full_name ?? null }
          : null,
      };
    });

    if (ctx.canWrite) {
      // Learners that hold credit right now. The database re-checks the exact refundable amount on
      // the chosen payment, so this list only narrows the choices.
      const { data: creditData, error: creditError } = await supabase
        .from("v_student_balances")
        .select("student_id, credit_balance")
        .gt("credit_balance", 0)
        .order("credit_balance", { ascending: false })
        .limit(200);
      if (creditError) {
        console.error("[refunds] credit list failed", creditError);
        throw new Error("Failed to load refunds. Please try again.");
      }
      const credit = (creditData ?? []) as { student_id: string; credit_balance: number | string }[];
      const ids = credit.map((c) => c.student_id);

      if (ids.length > 0) {
        const [{ data: studentData, error: studentError }, { data: payData, error: payError }] = await Promise.all([
          supabase.from("students").select("id, first_name, last_name, admission_number").in("id", ids),
          supabase
            .from("payments")
            .select("id, student_id, method, reference, amount, recorded_at")
            .in("student_id", ids)
            .in("status", ["confirmed", "recorded"])
            .order("recorded_at", { ascending: false })
            .limit(1000),
        ]);
        if (studentError || payError) {
          console.error("[refunds] candidates failed", studentError ?? payError);
          throw new Error("Failed to load refunds. Please try again.");
        }
        const students = new Map(((studentData ?? []) as { id: string; first_name: string | null; last_name: string | null; admission_number: string | null }[]).map((s) => [s.id, s]));
        const payments = (payData ?? []) as { id: string; student_id: string; method: string; reference: string | null; amount: number | string; recorded_at: string }[];

        candidates = credit
          .map((c) => {
            const s = students.get(c.student_id) ?? null;
            return {
              studentId: c.student_id,
              name: fullName(s),
              admissionNumber: s?.admission_number ?? null,
              credit: Number(c.credit_balance),
              payments: payments
                .filter((p) => p.student_id === c.student_id)
                .map((p) => ({
                  id: p.id,
                  label: `${methodLabel(p.method)} ${p.reference ?? ""} - ${kes(Number(p.amount))} - ${day(p.recorded_at)}`.replace(/\s+/g, " "),
                })),
            };
          })
          .filter((c) => c.payments.length > 0);
      }
    }
  }

  return (
    <FinancePageShell ctx={ctx} section="Refunds" title="Refunds" subtitle="Return money held as credit, with a second person's approval">
      <RefundsSection rows={rows} candidates={candidates} canWrite={ctx.canWrite} canApprove={canApprove} />
    </FinancePageShell>
  );
}
