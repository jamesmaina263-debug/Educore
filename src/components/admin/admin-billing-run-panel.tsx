"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDateOnly, formatKes } from "@/lib/billing/format";
import { previewBillingCycleAction, runBillingCycleNowAction, type CycleRow } from "@/app/(admin)/admin/billing/invoices/actions";

const REASONS: Record<string, string> = {
  already_invoiced: "Already invoiced",
  no_plan_assigned: "No plan assigned",
  no_billable_students: "No billable students",
  overlaps_existing_invoice: "Overlaps an existing invoice",
  overlaps_earlier_term_in_this_run: "Overlaps another term in this run",
  subscription_started_after_term_ended: "Subscription started after the term ended",
};
const reasonText = (r: string | null) => (r ? REASONS[r] ?? r : "");

// "What would the billing run do right now?" -- an exact, read-only preview using the same SQL
// planner as the scheduled run, so an administrator can see (and trust) it before enabling
// automation, and run it by hand at any time.
export function AdminBillingRunPanel({ autoEnabled, autoIssue }: { autoEnabled: boolean; autoIssue: boolean }) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<CycleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const create = (rows ?? []).filter((r) => r.decision === "create");
  const skipped = (rows ?? []).filter((r) => r.decision !== "create" && r.reason !== "already_invoiced");

  return (
    <div className="panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div>
          <h2 className="text-[0.8125rem] font-semibold">Billing run</h2>
          <p className="text-xs text-muted-foreground">
            Automatic billing is <strong>{autoEnabled ? "ON" : "OFF"}</strong>. It runs daily (06:00 EAT) and invoices each paying school once its term has ended —{" "}
            {autoIssue ? "invoices are issued automatically" : "invoices are created as drafts for you to review"}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              setError(null);
              setResult(null);
              startTransition(async () => {
                const res = await previewBillingCycleAction();
                if ("error" in res) setError(res.error);
                else setRows(res.rows);
              });
            }}
          >
            {pending ? "Checking…" : "Preview run"}
          </Button>
          <Button
            size="sm"
            disabled={pending || !rows || create.length === 0}
            onClick={() => {
              if (!window.confirm(`Create ${create.length} invoice${create.length === 1 ? "" : "s"} now as ${autoIssue ? "ISSUED invoices (schools will see them)" : "drafts"}?`)) return;
              setError(null);
              startTransition(async () => {
                const res = await runBillingCycleNowAction();
                if ("error" in res) return setError(res.error);
                setResult(`Created ${res.created} ${res.status} invoice${res.created === 1 ? "" : "s"}; ${res.skipped} skipped.${res.errors.length ? ` Problems: ${res.errors.join("; ")}` : ""}`);
                setRows(null);
              });
            }}
          >
            Run now
          </Button>
        </div>
      </header>
      <div className="p-4 text-sm">
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {result && (
          <p role="status" className="text-success">
            {result}{" "}
            <Link className="underline" href="/admin/billing/invoices?status=draft">
              Review invoices
            </Link>
          </p>
        )}
        {!rows && !error && !result && <p className="text-muted-foreground">Preview shows exactly which schools would be invoiced, for which term, and why others are skipped. Nothing is created by a preview.</p>}
        {rows && (
          <div className="flex flex-col gap-4">
            <section>
              <h3 className="mb-1 font-medium">Would create ({create.length})</h3>
              {create.length === 0 ? (
                <p className="text-muted-foreground">Nothing to invoice right now.</p>
              ) : (
                <table className="table-dense w-full">
                  <thead className="bg-muted/70">
                    <tr>
                      <th>School</th>
                      <th>Period</th>
                      <th className="text-right">Students × rate</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {create.map((r) => (
                      <tr key={`${r.school_id}-${r.period_start}`}>
                        <td className="font-medium">{r.school_name}</td>
                        <td>
                          {r.label} <span className="text-xs text-muted-foreground">({formatDateOnly(r.period_start)} – {formatDateOnly(r.period_end)})</span>
                        </td>
                        <td className="text-right tabular-nums">
                          {r.students} × {formatKes(r.unit_price_kes)}
                        </td>
                        <td className="text-right font-medium tabular-nums">{formatKes(r.total_kes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            {skipped.length > 0 && (
              <section>
                <h3 className="mb-1 font-medium">Skipped ({skipped.length})</h3>
                <ul className="text-muted-foreground">
                  {skipped.map((r) => (
                    <li key={`${r.school_id}-${r.period_start}`}>
                      {r.school_name} — {r.label}: {reasonText(r.reason)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
