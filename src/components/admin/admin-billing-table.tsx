"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  activateSchoolSubscription,
  suspendSchoolSubscription,
  generateSchoolInvoice,
  recordSchoolPayment,
} from "@/app/(admin)/admin/billing/actions";

export type InvoiceRow = {
  id: string;
  school_id: string;
  period_start: string;
  period_end: string;
  amount_kes: number;
  status: string;
  due_at: string;
};

export type SchoolBillingRow = {
  school_id: string;
  school_name: string;
  school_status: string;
  subscription_status: string | null;
  plan_id: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  invoices: InvoiceRow[];
};

type PlanOption = { id: string; code: string; name: string; price_per_student_kes: number };

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  trial: "neutral",
  trialing: "neutral",
  active: "success",
  past_due: "warning",
  suspended: "danger",
  cancelled: "danger",
};

function toneFor(status: string | null) {
  return status ? STATUS_TONE[status] ?? "neutral" : "neutral";
}

export function AdminBillingTable({ rows, plans }: { rows: SchoolBillingRow[]; plans: PlanOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Record<string, string>>({});
  const [periodEnd, setPeriodEnd] = useState<Record<string, string>>({});
  const [invoicePeriod, setInvoicePeriod] = useState<Record<string, { start: string; end: string }>>({});
  const [paymentRef, setPaymentRef] = useState<Record<string, string>>({});

  function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Schools</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {rows.length} school{rows.length === 1 ? "" : "s"}
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>School</th>
                <th>School status</th>
                <th>Subscription</th>
                <th>Trial / period end</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <>
                  <tr key={row.school_id}>
                    <td className="font-medium">{row.school_name}</td>
                    <td>
                      <StatusBadge tone={toneFor(row.school_status)} label={row.school_status ?? "—"} />
                    </td>
                    <td>
                      <StatusBadge
                        tone={toneFor(row.subscription_status)}
                        label={row.subscription_status ?? "no subscription"}
                      />
                    </td>
                    <td className="text-muted-foreground">
                      {row.trial_ends_at
                        ? new Date(row.trial_ends_at).toLocaleDateString()
                        : row.current_period_end
                          ? new Date(row.current_period_end).toLocaleDateString()
                          : "—"}
                    </td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpanded(expanded === row.school_id ? null : row.school_id)}
                      >
                        {expanded === row.school_id ? "Close" : "Manage"}
                      </Button>
                    </td>
                  </tr>
                  {expanded === row.school_id && (
                    <tr key={`${row.school_id}-expanded`}>
                      <td colSpan={5} className="bg-muted/30">
                        <div className="flex flex-col gap-4 p-4">
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Activate on plan</p>
                              <Select
                                value={selectedPlan[row.school_id] ?? ""}
                                onValueChange={(v) => setSelectedPlan((p) => ({ ...p, [row.school_id]: v }))}
                              >
                                <SelectTrigger className="w-40">
                                  <SelectValue placeholder="Plan" />
                                </SelectTrigger>
                                <SelectContent>
                                  {plans.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Period end</p>
                              <Input
                                type="date"
                                className="w-40"
                                value={periodEnd[row.school_id] ?? ""}
                                onChange={(e) => setPeriodEnd((p) => ({ ...p, [row.school_id]: e.target.value }))}
                              />
                            </div>
                            <Button
                              size="sm"
                              disabled={pending || !selectedPlan[row.school_id] || !periodEnd[row.school_id]}
                              onClick={() =>
                                run(() =>
                                  activateSchoolSubscription(
                                    row.school_id,
                                    selectedPlan[row.school_id],
                                    periodEnd[row.school_id],
                                  ),
                                )
                              }
                            >
                              Activate
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={pending}
                              onClick={() => run(() => suspendSchoolSubscription(row.school_id, "Suspended by platform admin."))}
                            >
                              Suspend
                            </Button>
                          </div>

                          <div className="flex flex-wrap items-end gap-2">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Invoice period start</p>
                              <Input
                                type="date"
                                className="w-40"
                                value={invoicePeriod[row.school_id]?.start ?? ""}
                                onChange={(e) =>
                                  setInvoicePeriod((p) => ({
                                    ...p,
                                    [row.school_id]: { start: e.target.value, end: p[row.school_id]?.end ?? "" },
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Invoice period end</p>
                              <Input
                                type="date"
                                className="w-40"
                                value={invoicePeriod[row.school_id]?.end ?? ""}
                                onChange={(e) =>
                                  setInvoicePeriod((p) => ({
                                    ...p,
                                    [row.school_id]: { start: p[row.school_id]?.start ?? "", end: e.target.value },
                                  }))
                                }
                              />
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending || !invoicePeriod[row.school_id]?.start || !invoicePeriod[row.school_id]?.end}
                              onClick={() =>
                                run(() =>
                                  generateSchoolInvoice(
                                    row.school_id,
                                    invoicePeriod[row.school_id].start,
                                    invoicePeriod[row.school_id].end,
                                  ),
                                )
                              }
                            >
                              Generate invoice
                            </Button>
                          </div>

                          <div className="panel">
                            <header className="border-b border-border px-3 py-2">
                              <h3 className="text-[0.75rem] font-semibold">Invoices</h3>
                            </header>
                            <table className="table-dense w-full">
                              <thead className="bg-muted/70">
                                <tr>
                                  <th>Period</th>
                                  <th className="text-right">Amount (KES)</th>
                                  <th>Status</th>
                                  <th>Due</th>
                                  <th>Record payment</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.invoices.length === 0 && (
                                  <tr>
                                    <td colSpan={5} className="text-center text-muted-foreground">
                                      No invoices yet.
                                    </td>
                                  </tr>
                                )}
                                {row.invoices.map((inv) => (
                                  <tr key={inv.id}>
                                    <td className="text-muted-foreground">
                                      {new Date(inv.period_start).toLocaleDateString()} –{" "}
                                      {new Date(inv.period_end).toLocaleDateString()}
                                    </td>
                                    <td className="text-right" data-numeric>
                                      {inv.amount_kes.toLocaleString()}
                                    </td>
                                    <td>
                                      <StatusBadge
                                        tone={inv.status === "paid" ? "success" : inv.status === "overdue" ? "danger" : "neutral"}
                                        label={inv.status}
                                      />
                                    </td>
                                    <td className="text-muted-foreground">{new Date(inv.due_at).toLocaleDateString()}</td>
                                    <td>
                                      {inv.status !== "paid" && (
                                        <div className="flex items-center gap-1">
                                          <Input
                                            placeholder="Reference"
                                            className="h-8 w-28"
                                            value={paymentRef[inv.id] ?? ""}
                                            onChange={(e) => setPaymentRef((p) => ({ ...p, [inv.id]: e.target.value }))}
                                          />
                                          <Button
                                            size="sm"
                                            disabled={pending}
                                            onClick={() => run(() => recordSchoolPayment(inv.id, paymentRef[inv.id] ?? ""))}
                                          >
                                            Mark paid
                                          </Button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
