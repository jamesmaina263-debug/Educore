"use client";

import { useState, useTransition } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cancelOwnSubscription } from "@/app/(app)/settings/billing-actions";

export type BillingInvoice = {
  id: string;
  period_start: string;
  period_end: string;
  student_count: number;
  amount_kes: number;
  status: string;
  due_at: string;
  paid_at: string | null;
};

export type BillingData = {
  status: string | null;
  plan_name: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  invoices: BillingInvoice[];
};

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  trialing: "neutral",
  active: "success",
  past_due: "warning",
  suspended: "danger",
  cancelled: "danger",
};

export function BillingPanel({ data, canManage }: { data: BillingData; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const handleCancel = () => {
    setError(null);
    startTransition(async () => {
      const result = await cancelOwnSubscription();
      if (result && "error" in result) setError(result.error);
      setConfirming(false);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex items-center gap-3 p-4">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">Plan</p>
          <p className="font-medium">{data.plan_name ?? "No plan assigned"}</p>
        </div>
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">Status</p>
          <StatusBadge
            tone={data.status ? STATUS_TONE[data.status] ?? "neutral" : "neutral"}
            label={data.status ?? "unknown"}
          />
        </div>
        {data.status === "trialing" && data.trial_ends_at && (
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">Trial ends</p>
            <p className="font-medium">{new Date(data.trial_ends_at).toLocaleDateString()}</p>
          </div>
        )}
        {data.current_period_end && (
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">Current period ends</p>
            <p className="font-medium">{new Date(data.current_period_end).toLocaleDateString()}</p>
          </div>
        )}
      </div>

      {canManage && data.status && !["cancelled"].includes(data.status) && (
        <div>
          {!confirming ? (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              Cancel subscription
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                This will suspend the school&apos;s access. Are you sure?
              </p>
              <Button variant="destructive" disabled={pending} onClick={handleCancel}>
                {pending ? "Cancelling…" : "Yes, cancel"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep subscription
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      <div className="panel">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Invoice history</h2>
        </header>
        <div className="overflow-x-auto">
          <Table className="table-dense">
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Students</TableHead>
              <TableHead>Amount (KES)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.invoices.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No invoices yet.
                </TableCell>
              </TableRow>
            )}
            {data.invoices.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>
                  {new Date(inv.period_start).toLocaleDateString()} –{" "}
                  {new Date(inv.period_end).toLocaleDateString()}
                </TableCell>
                <TableCell>{inv.student_count}</TableCell>
                <TableCell>{inv.amount_kes.toLocaleString()}</TableCell>
                <TableCell>
                  <StatusBadge
                    tone={inv.status === "paid" ? "success" : inv.status === "overdue" ? "danger" : "neutral"}
                    label={inv.status}
                  />
                </TableCell>
                <TableCell>{new Date(inv.due_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </div>
    </div>
  );
}
