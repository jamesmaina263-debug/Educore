"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { sendBillingReminder } from "@/app/(admin)/admin/billing/actions";

export interface OverdueInvoiceRow {
  id: string;
  school_id: string;
  school_name: string;
  amount_kes: number;
  due_at: string;
  reminder_sent_at: string | null;
}

function daysOverdue(dueAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(dueAt).getTime()) / 86_400_000));
}

// mark_invoices_overdue()/suspend_schools_with_overdue_invoices() (run daily via
// /api/cron/billing) already suspend a school 7 days after this list would first show it --
// this is the human-facing nudge in between, not a replacement for that policy.
export function AdminDunningList({ invoices }: { invoices: OverdueInvoiceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nowMs = new Date().getTime();

  function handleSend(invoiceId: string) {
    setError(null);
    setSendingId(invoiceId);
    startTransition(async () => {
      const res = await sendBillingReminder(invoiceId);
      setSendingId(null);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  if (invoices.length === 0) return null;

  return (
    <div className="panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">Overdue invoices</h2>
        <span className="text-[0.6875rem] text-muted-foreground">
          Auto-suspends 7 days after going overdue if unpaid
        </span>
      </header>
      {error && (
        <p role="alert" className="px-4 pt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead className="bg-muted/70">
            <tr>
              <th>School</th>
              <th>Amount</th>
              <th>Overdue</th>
              <th>Last reminder</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const days = daysOverdue(inv.due_at, nowMs);
              return (
                <tr key={inv.id}>
                  <td className="font-medium">{inv.school_name}</td>
                  <td>KES {inv.amount_kes.toLocaleString()}</td>
                  <td>
                    <StatusBadge tone={days >= 5 ? "danger" : "warning"} label={`${days}d overdue`} />
                  </td>
                  <td className="text-muted-foreground">
                    {inv.reminder_sent_at
                      ? `${daysOverdue(inv.reminder_sent_at, nowMs)}d ago`
                      : "Never sent"}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending && sendingId === inv.id}
                      onClick={() => handleSend(inv.id)}
                    >
                      {pending && sendingId === inv.id ? "Sending…" : "Send reminder"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
