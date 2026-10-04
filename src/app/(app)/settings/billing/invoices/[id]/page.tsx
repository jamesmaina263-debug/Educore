import Link from "next/link";
import { notFound } from "next/navigation";
import { loadSettingsContext } from "../../../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { InvoiceStatusBadge } from "@/components/billing/invoice-status-badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { PAYMENT_INSTRUCTION_FIELDS, formatDateOnly, formatInstantDate, formatKes } from "@/lib/billing/format";
import { INVOICE_COLUMNS, invoiceDescription, toInvoiceRecord } from "@/lib/billing/invoice-types";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A school's own view of one EduCore invoice. The query runs as the signed-in user, so row-level
// security is the only thing that decides what exists: another school's invoice, a draft, or an
// unknown id all produce the same 404 here.
export default async function SchoolInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const ctx = await loadSettingsContext();
  const supabase = await createClient();
  const { data: row } = ctx.billingData ? await supabase.from("platform_invoices").select(INVOICE_COLUMNS).eq("id", id).maybeSingle() : { data: null };
  if (ctx.billingData && !row) notFound();
  const inv = row ? toInvoiceRecord(row as unknown as Record<string, unknown>) : null;

  const instructions = inv?.payment_instructions ?? {};
  const instructionRows = PAYMENT_INSTRUCTION_FIELDS.map((f) => ({ ...f, value: (instructions[f.key] ?? "").toString().trim() })).filter((f) => f.value);
  const payable = inv && ["issued", "sent", "partially_paid", "overdue"].includes(inv.status);
  const rate = inv ? inv.unit_price_kes ?? (inv.student_count > 0 ? inv.subtotal_kes / inv.student_count : 0) : 0;

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Billing"
      title="Settings"
      noAccess={!ctx.billingData}
    >
      {inv && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">
                <Link href="/settings/billing" className="hover:underline">
                  Billing
                </Link>{" "}
                / {inv.invoice_number}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <h2 className="text-lg font-semibold">Invoice {inv.invoice_number}</h2>
                <InvoiceStatusBadge status={inv.status} />
              </div>
              <p className="text-sm text-muted-foreground">{inv.billing_period_label}</p>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={`/api/billing/invoices/${inv.id}/pdf?inline=1`} target="_blank" rel="noreferrer">
                  View PDF
                </a>
              </Button>
              <Button asChild size="sm">
                <a href={`/api/billing/invoices/${inv.id}/pdf`}>Download PDF</a>
              </Button>
            </div>
          </div>

          <div className="panel">
            <div className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-4">
              <Fact label="Invoice date" value={formatDateOnly(inv.invoice_date)} />
              <Fact label="Billing period" value={`${formatDateOnly(inv.period_start)} – ${formatDateOnly(inv.period_end)}`} />
              <Fact label="Due date" value={formatInstantDate(inv.due_at)} />
              <Fact label="Status" value={inv.status === "paid" && inv.paid_at ? `Paid ${formatInstantDate(inv.paid_at)}` : inv.status.replace("_", " ")} />
            </div>
            <div className="border-t border-border p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-medium">Description</th>
                    <th className="pb-2 text-right font-medium">Students</th>
                    <th className="pb-2 text-right font-medium">Rate</th>
                    <th className="pb-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="py-2">{invoiceDescription(inv)}</td>
                    <td className="py-2 text-right tabular-nums">{inv.student_count.toLocaleString("en-KE")}</td>
                    <td className="py-2 text-right tabular-nums">{formatKes(rate)}</td>
                    <td className="py-2 text-right tabular-nums">{formatKes(inv.subtotal_kes)}</td>
                  </tr>
                  {inv.discount_kes > 0 && (
                    <tr>
                      <td className="py-1 text-muted-foreground" colSpan={3}>Discount</td>
                      <td className="py-1 text-right tabular-nums">- {formatKes(inv.discount_kes)}</td>
                    </tr>
                  )}
                  {inv.tax_kes > 0 && (
                    <tr>
                      <td className="py-1 text-muted-foreground" colSpan={3}>{inv.tax_label ?? "Tax"} ({inv.tax_rate_percent}%)</td>
                      <td className="py-1 text-right tabular-nums">{formatKes(inv.tax_kes)}</td>
                    </tr>
                  )}
                  <tr className="border-t border-border font-semibold">
                    <td className="pt-2" colSpan={3}>Total</td>
                    <td className="pt-2 text-right tabular-nums">{formatKes(inv.amount_kes)}</td>
                  </tr>
                  {inv.amount_paid_kes > 0 && (
                    <>
                      <tr>
                        <td className="py-1 text-muted-foreground" colSpan={3}>Paid</td>
                        <td className="py-1 text-right tabular-nums">- {formatKes(inv.amount_paid_kes)}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td className="py-1" colSpan={3}>Balance due</td>
                        <td className="py-1 text-right tabular-nums">{formatKes(inv.balance_kes)}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
              {inv.notes && <p className="mt-3 text-sm text-muted-foreground">{inv.notes}</p>}
            </div>
          </div>

          {payable && (
            <div className="panel">
              <header className="border-b border-border px-4 py-2.5">
                <h3 className="text-[0.8125rem] font-semibold">How to pay</h3>
              </header>
              <div className="p-4 text-sm">
                {instructionRows.length === 0 ? (
                  <p className="text-muted-foreground">
                    Payment details for this invoice are available from EduCore billing: info@educoreafrica.com or WhatsApp +254 702 904 562. Please quote invoice number {inv.invoice_number}.
                  </p>
                ) : (
                  <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {instructionRows.map((f) => (
                      <div key={f.key} className={f.long ? "sm:col-span-2" : ""}>
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                        <dd className="font-medium">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {instructionRows.length > 0 && !instructions.reference_note && (
                  <p className="mt-3 text-muted-foreground">Please quote invoice number {inv.invoice_number} when making payment.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </ModulePageShell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium capitalize">{value}</p>
    </div>
  );
}
