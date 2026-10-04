import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InvoiceStatusBadge } from "@/components/billing/invoice-status-badge";
import { AdminBillingTermsForm, AdminInvoiceActions, AdminVoidPaymentButton } from "@/components/admin/admin-invoice-actions";
import { Button } from "@/components/ui/button";
import { PAYMENT_METHOD_LABEL, formatDateOnly, formatInstantDate, formatKes, nairobiDateISO } from "@/lib/billing/format";
import { INVOICE_COLUMNS, invoiceDescription, toInvoiceRecord } from "@/lib/billing/invoice-types";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  generated: "Invoice document generated",
  issued: "Issued",
  sent: "Sent",
  send_failed: "Email failed",
  downloaded: "PDF downloaded",
  payment_recorded: "Payment recorded",
  payment_voided: "Payment voided",
  paid: "Marked paid",
  cancelled: "Cancelled",
  regenerated: "PDF regenerated",
  reissued: "Reissued",
  adjusted: "Adjusted",
  due_date_changed: "Due date changed",
  notes_updated: "Notes updated",
  recalculated: "Recalculated",
  overdue: "Became overdue",
  reminder_sent: "Reminder sent",
};

function describe(type: string, m: Record<string, unknown>): string {
  const kes = (v: unknown) => formatKes(Number(v));
  switch (type) {
    case "created":
      return m.backfilled
        ? "Existing invoice numbered when invoice numbering was introduced."
        : `${m.source === "auto" ? "Automatically" : "Manually"} created as ${String(m.status)} — ${String(m.students)} students × ${kes(m.unit_price_kes)} = ${kes(m.total_kes)}.`;
    case "issued":
      return m.due_at ? `Due ${formatInstantDate(String(m.due_at))}.` : "";
    case "sent":
      return m.to ? `Emailed to ${String(m.to)}.` : "";
    case "send_failed":
      return `${m.to ? `To ${String(m.to)}: ` : ""}${String(m.error ?? "")}`;
    case "payment_recorded":
      return `${kes(m.amount_kes)} via ${PAYMENT_METHOD_LABEL[String(m.method)] ?? String(m.method)}${m.reference ? ` (${String(m.reference)})` : ""}. Balance ${kes(m.balance_kes)}.`;
    case "payment_voided":
      return `${kes(m.amount_kes)} voided — ${String(m.reason ?? "")}`;
    case "adjusted":
      return `Discount ${kes(m.previous_discount_kes)} → ${kes(m.discount_kes)}; total ${kes(m.previous_total_kes)} → ${kes(m.total_kes)}. ${String(m.reason ?? "")}`;
    case "due_date_changed":
      return `${formatInstantDate(String(m.from))} → ${formatInstantDate(String(m.to))}. ${String(m.reason ?? "")}`;
    case "cancelled":
    case "reissued":
      return String(m.reason ?? "");
    case "recalculated":
      return `${String(m.students)} students, total ${kes(m.total_kes)}.`;
    case "regenerated":
      return `Version ${String(m.pdf_version)}.`;
    default:
      return "";
  }
}

export default async function AdminInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { data: row } = await supabase.from("platform_invoices").select(INVOICE_COLUMNS).eq("id", id).maybeSingle();
  if (!row) notFound();
  const inv = toInvoiceRecord(row as unknown as Record<string, unknown>);

  const [{ data: school }, { data: sub }, { data: payments }, { data: events }, { data: related }] = await Promise.all([
    supabase.from("schools").select("id, name, status").eq("id", inv.school_id).maybeSingle(),
    supabase
      .from("school_subscriptions")
      .select("status, price_override_kes, recurring_discount_percent, discount_note, billing_email, plan_id")
      .eq("school_id", inv.school_id)
      .maybeSingle(),
    supabase.from("platform_invoice_payments").select("id, amount_kes, paid_on, method, reference, recorded_by_label, voided_at, voided_reason, created_at").eq("invoice_id", id).order("created_at"),
    supabase.from("platform_invoice_events").select("id, event_type, actor_label, metadata, created_at").eq("invoice_id", id).order("created_at", { ascending: false }).limit(200),
    supabase.from("platform_invoices").select("id, invoice_number, replaces_invoice_id").or(`id.eq.${inv.replaces_invoice_id ?? id},replaces_invoice_id.eq.${id}`),
  ]);
  const { data: plan } = sub?.plan_id
    ? await supabase.from("subscription_plans").select("price_per_student_kes").eq("id", sub.plan_id).maybeSingle()
    : { data: null };

  const replaces = (related ?? []).find((r) => r.id === inv.replaces_invoice_id);
  const replacedBy = (related ?? []).find((r) => r.replaces_invoice_id === id);
  const rate = inv.unit_price_kes ?? (inv.student_count > 0 ? inv.subtotal_kes / inv.student_count : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link href="/admin/billing/invoices" className="hover:underline">
              Invoices
            </Link>{" "}
            / {inv.invoice_number}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-lg font-semibold">{inv.invoice_number}</h1>
            <InvoiceStatusBadge status={inv.status} />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{inv.source === "auto" ? "Automatic" : "Manual"}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {school?.name ?? "Unknown school"} · {inv.billing_period_label ?? `${formatDateOnly(inv.period_start)} – ${formatDateOnly(inv.period_end)}`}
          </p>
          {replaces && (
            <p className="text-xs text-muted-foreground">
              Replaces <Link className="underline" href={`/admin/billing/invoices/${replaces.id}`}>{replaces.invoice_number}</Link>
            </p>
          )}
          {replacedBy && (
            <p className="text-xs text-muted-foreground">
              Replaced by <Link className="underline" href={`/admin/billing/invoices/${replacedBy.id}`}>{replacedBy.invoice_number}</Link>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/billing/invoices/${id}/pdf?inline=1`} target="_blank" rel="noreferrer">
              View PDF
            </a>
          </Button>
          <Button asChild size="sm">
            <a href={`/api/billing/invoices/${id}/pdf`}>Download PDF</a>
          </Button>
        </div>
      </div>

      {inv.status === "draft" && (
        <div className="rounded-md border border-warning/30 bg-warning-subtle px-4 py-3 text-sm">
          <strong>Draft.</strong> The school cannot see this invoice and it will not become overdue. Review the figures, then <em>Issue invoice</em>.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <div className="panel">
            <header className="border-b border-border px-4 py-2.5">
              <h2 className="text-[0.8125rem] font-semibold">Who was billed, and how it was calculated</h2>
            </header>
            <div className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
              <Fact label="Billed to" value={inv.bill_to?.name ?? school?.name ?? "—"} sub={[inv.bill_to?.email, inv.bill_to?.phone].filter(Boolean).join(" · ")} />
              <Fact label="Billing period" value={inv.billing_period_label ?? "—"} sub={`${formatDateOnly(inv.period_start)} – ${formatDateOnly(inv.period_end)}`} />
              <Fact label="Invoice date" value={inv.status === "draft" ? "Not issued yet" : formatDateOnly(inv.invoice_date)} sub={inv.sent_at ? `Emailed ${formatInstantDate(inv.sent_at)}${inv.sent_to ? ` to ${inv.sent_to}` : ""}` : inv.status === "draft" ? undefined : "Not emailed yet"} />
              <Fact label="Due date" value={formatInstantDate(inv.due_at)} />
            </div>
            <div className="border-t border-border p-4">
              <table className="w-full text-sm">
                <tbody>
                  <tr>
                    <td className="py-1 text-muted-foreground">{invoiceDescription(inv)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {inv.student_count.toLocaleString("en-KE")} students × {formatKes(rate)}
                    </td>
                    <td className="w-32 py-1 text-right font-medium tabular-nums">{formatKes(inv.subtotal_kes)}</td>
                  </tr>
                  {inv.discount_kes > 0 && (
                    <tr>
                      <td className="py-1 text-muted-foreground" colSpan={2}>Discount</td>
                      <td className="py-1 text-right tabular-nums">- {formatKes(inv.discount_kes)}</td>
                    </tr>
                  )}
                  {inv.tax_kes > 0 && (
                    <tr>
                      <td className="py-1 text-muted-foreground" colSpan={2}>{inv.tax_label ?? "Tax"} ({inv.tax_rate_percent}%)</td>
                      <td className="py-1 text-right tabular-nums">{formatKes(inv.tax_kes)}</td>
                    </tr>
                  )}
                  <tr className="border-t border-border">
                    <td className="pt-2 font-semibold" colSpan={2}>Total</td>
                    <td className="pt-2 text-right font-semibold tabular-nums">{formatKes(inv.amount_kes)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-muted-foreground" colSpan={2}>Paid</td>
                    <td className="py-1 text-right tabular-nums">{formatKes(inv.amount_paid_kes)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 font-semibold" colSpan={2}>Balance</td>
                    <td className="py-1 text-right font-semibold tabular-nums">{inv.status === "cancelled" ? "—" : formatKes(inv.balance_kes)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">
                {inv.plan_name ? `${inv.plan_name} plan. ` : ""}Billable students are those with status {(inv.billable_statuses ?? ["active"]).join(" or ")} on the day the invoice was created.
              </p>
              {inv.notes && <p className="mt-2 text-sm">Notes on invoice: {inv.notes}</p>}
            </div>
          </div>

          <div className="panel">
            <header className="border-b border-border px-4 py-2.5">
              <h2 className="text-[0.8125rem] font-semibold">Payments</h2>
            </header>
            {(payments ?? []).length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No payments recorded.</p>
            ) : (
              <table className="table-dense w-full">
                <thead className="bg-muted/70">
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th className="text-right">Amount</th>
                    <th>Recorded by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(payments ?? []).map((pay) => (
                    <tr key={pay.id} className={pay.voided_at ? "text-muted-foreground line-through" : ""}>
                      <td>{formatDateOnly(pay.paid_on)}</td>
                      <td>{PAYMENT_METHOD_LABEL[pay.method] ?? pay.method}</td>
                      <td>{pay.reference ?? "—"}</td>
                      <td className="text-right tabular-nums">{formatKes(pay.amount_kes)}</td>
                      <td className="no-underline">{pay.voided_at ? `Voided: ${pay.voided_reason ?? ""}` : pay.recorded_by_label ?? "—"}</td>
                      <td className="text-right">{!pay.voided_at && inv.status !== "cancelled" && <AdminVoidPaymentButton invoiceId={id} paymentId={pay.id} amount={Number(pay.amount_kes)} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <header className="border-b border-border px-4 py-2.5">
              <h2 className="text-[0.8125rem] font-semibold">History</h2>
              <p className="text-xs text-muted-foreground">Append-only audit trail of everything that has happened to this invoice.</p>
            </header>
            <ol className="divide-y divide-border">
              {(events ?? []).map((e) => (
                <li key={e.id} className="flex gap-3 px-4 py-2.5 text-sm">
                  <time className="w-36 shrink-0 text-xs text-muted-foreground" dateTime={e.created_at}>
                    {new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" }).format(new Date(e.created_at))}
                  </time>
                  <div className="min-w-0">
                    <p className="font-medium">
                      {EVENT_LABEL[e.event_type] ?? e.event_type} <span className="font-normal text-muted-foreground">· {e.actor_label}</span>
                    </p>
                    {describe(e.event_type, (e.metadata ?? {}) as Record<string, unknown>) && (
                      <p className="text-xs text-muted-foreground">{describe(e.event_type, (e.metadata ?? {}) as Record<string, unknown>)}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <AdminInvoiceActions
            invoiceId={id}
            invoiceNumber={inv.invoice_number}
            status={inv.status}
            amount={inv.amount_kes}
            amountPaid={inv.amount_paid_kes}
            balance={inv.balance_kes}
            discount={inv.discount_kes}
            subtotal={inv.subtotal_kes}
            dueOn={nairobiDateISO(inv.due_at)}
            notes={inv.notes}
            sentAt={inv.sent_at}
            suggestedEmail={sub?.billing_email ?? inv.bill_to?.email ?? null}
            todayISO={nairobiDateISO()}
          />
          <AdminBillingTermsForm
            schoolId={inv.school_id}
            invoiceId={id}
            planPrice={plan ? Number(plan.price_per_student_kes) : null}
            priceOverride={sub?.price_override_kes == null ? null : Number(sub.price_override_kes)}
            discountPercent={Number(sub?.recurring_discount_percent ?? 0)}
            discountNote={sub?.discount_note ?? null}
            billingEmail={sub?.billing_email ?? null}
          />
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
