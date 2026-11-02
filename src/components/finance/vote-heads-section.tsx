"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createVoteHeadAction,
  mapVoteHeadAction,
  setVoteHeadActiveAction,
  unmapVoteHeadAction,
} from "@/app/(app)/finance/vote-heads/actions";
import { sourceForKind, type LedgerLine, type MappingSource, type VoteHeadKind } from "@/lib/vote-heads";

export interface VoteHeadOption {
  id: string;
  code: string;
  name: string;
  kind: VoteHeadKind;
  isActive: boolean;
}
export interface MappingRow {
  source: MappingSource;
  matchKey: string;
  voteHeadCode: string;
}
export interface ReconciliationView {
  invoicedTotal: number;
  incomeLedgerTotal: number;
  incomeDifference: number;
  approvedExpenseTotal: number;
  expenseLedgerTotal: number;
  expenseDifference: number;
}

const kes = (n: number) => `KES ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ line }: { line: LedgerLine }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2 font-mono text-xs">{line.code}</td>
      <td className="px-3 py-2">{line.name}</td>
      <td className="px-3 py-2 text-right" data-numeric>{line.lines}</td>
      <td className="px-3 py-2 text-right" data-numeric>{kes(line.amount)}</td>
    </tr>
  );
}

function Table({ title, rows, total }: { title: string; rows: LedgerLine[]; total: number }) {
  return (
    <div className="panel overflow-x-auto">
      <h3 className="px-3 pt-3 text-sm font-semibold">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-3 py-2">Code</th>
            <th className="px-3 py-2">Vote head</th>
            <th className="px-3 py-2 text-right">Lines</th>
            <th className="px-3 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Nothing yet.</td></tr>
          ) : (
            rows.map((l) => <Row key={`${l.code}-${l.kind}-${l.voteHeadId ?? "x"}`} line={l} />)
          )}
          <tr className="border-t font-semibold">
            <td className="px-3 py-2" colSpan={3}>Total</td>
            <td className="px-3 py-2 text-right" data-numeric>{kes(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


function MapPicker({ source, itemName, heads, disabled, onMap }: { source: MappingSource; itemName: string; heads: VoteHeadOption[]; disabled: boolean; onMap: (source: MappingSource, name: string, headId: string) => void }) {
  const options = heads.filter((h) => h.isActive && sourceForKind(h.kind) === source);
  return (
    <select
      className="rounded border bg-background px-2 py-1 text-sm"
      defaultValue=""
      disabled={disabled || options.length === 0}
      onChange={(e) => e.target.value && onMap(source, itemName, e.target.value)}
      aria-label={`Vote head for ${itemName}`}
    >
      <option value="">Choose vote head…</option>
      {options.map((h) => (
        <option key={h.id} value={h.id}>{h.code} - {h.name}</option>
      ))}
    </select>
  );
}

export function VoteHeadsSection(props: {
  canWrite: boolean;
  terms: { id: string; name: string }[];
  termId: string | null;
  ledger: LedgerLine[];
  totals: { income: number; expense: number; net: number };
  reconciliation: ReconciliationView | null;
  reconciled: boolean;
  heads: VoteHeadOption[];
  mappings: MappingRow[];
  unmappedItems: string[];
  unmappedCategories: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<VoteHeadKind>("income");

  function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setMessage(null);
    start(async () => {
      const r = await fn();
      if ("error" in r) setMessage(r.error);
      else router.refresh();
    });
  }

  const onMap = (source: MappingSource, n: string, headId: string) => run(() => mapVoteHeadAction(source, n, headId));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label htmlFor="vh-term" className="text-muted-foreground">Period</label>
        <select
          id="vh-term"
          className="rounded border bg-background px-2 py-1"
          value={props.termId ?? ""}
          onChange={(e) => router.push(e.target.value ? `?term=${e.target.value}` : "?")}
        >
          <option value="">All time</option>
          {props.terms.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Income is counted when fees are invoiced; spending is counted when an expense is approved. Payments are not part of this view.
        </span>
      </div>

      {message && <p role="alert" className="panel border-destructive p-3 text-sm text-destructive">{message}</p>}

      {props.reconciliation && (
        <div className={`panel p-3 text-sm ${props.reconciled ? "" : "border-destructive"}`}>
          {props.reconciled ? (
            <p>
              Reconciled: the ledger accounts for all {kes(props.reconciliation.invoicedTotal)} invoiced and {kes(props.reconciliation.approvedExpenseTotal)} of approved expenses.
            </p>
          ) : (
            <p className="text-destructive">
              The ledger does not match the source records (income difference {kes(props.reconciliation.incomeDifference)}, spending difference {kes(props.reconciliation.expenseDifference)}). Do not rely on these figures; tell support.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Table title="Income by vote head" rows={props.ledger.filter((l) => l.kind === "income")} total={props.totals.income} />
        <Table title="Spending by vote head" rows={props.ledger.filter((l) => l.kind === "expense")} total={props.totals.expense} />
      </div>
      <p className="text-sm" data-numeric>Income less spending: <strong>{kes(props.totals.net)}</strong></p>

      {props.canWrite && (
        <div className="panel space-y-3 p-3">
          <h3 className="text-sm font-semibold">Add a vote head</h3>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <input className="w-28 rounded border bg-background px-2 py-1 font-mono uppercase" placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" />
            <input className="w-56 rounded border bg-background px-2 py-1" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
            <select className="rounded border bg-background px-2 py-1" value={kind} onChange={(e) => setKind(e.target.value as VoteHeadKind)} aria-label="Kind">
              <option value="income">Income</option>
              <option value="expense">Spending</option>
            </select>
            <button
              type="button"
              className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
              disabled={pending}
              onClick={() => run(async () => {
                const r = await createVoteHeadAction({ code, name, kind });
                if ("success" in r) { setCode(""); setName(""); }
                return r;
              })}
            >
              Add
            </button>
          </div>
          {props.heads.length > 0 && (
            <ul className="divide-y text-sm">
              {props.heads.map((h) => (
                <li key={h.id} className="flex items-center justify-between py-1">
                  <span><span className="font-mono text-xs">{h.code}</span> {h.name} <em className="text-xs text-muted-foreground">({h.kind === "income" ? "income" : "spending"}{h.isActive ? "" : ", switched off"})</em></span>
                  <button type="button" className="text-xs underline" disabled={pending} onClick={() => run(() => setVoteHeadActiveAction(h.id, !h.isActive))}>
                    {h.isActive ? "Switch off" : "Switch on"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel space-y-2 p-3">
          <h3 className="text-sm font-semibold">Fee items with no vote head</h3>
          {props.unmappedItems.length === 0 ? <p className="text-sm text-muted-foreground">All fee items are mapped.</p> : props.unmappedItems.map((n) => (
            <div key={n} className="flex items-center justify-between gap-2 text-sm"><span>{n}</span><MapPicker source="invoice_item" itemName={n} heads={props.heads} disabled={pending || !props.canWrite} onMap={onMap} /></div>
          ))}
        </div>
        <div className="panel space-y-2 p-3">
          <h3 className="text-sm font-semibold">Expense categories with no vote head</h3>
          {props.unmappedCategories.length === 0 ? <p className="text-sm text-muted-foreground">All expense categories are mapped.</p> : props.unmappedCategories.map((n) => (
            <div key={n} className="flex items-center justify-between gap-2 text-sm"><span>{n}</span><MapPicker source="expense_category" itemName={n} heads={props.heads} disabled={pending || !props.canWrite} onMap={onMap} /></div>
          ))}
        </div>
      </div>

      {props.mappings.length > 0 && (
        <div className="panel space-y-1 p-3">
          <h3 className="text-sm font-semibold">Current mappings</h3>
          <ul className="divide-y text-sm">
            {props.mappings.map((m) => (
              <li key={`${m.source}-${m.matchKey}`} className="flex items-center justify-between py-1">
                <span>{m.source === "invoice_item" ? "Fee item" : "Expense category"} “{m.matchKey}” → <span className="font-mono text-xs">{m.voteHeadCode}</span></span>
                {props.canWrite && (
                  <button type="button" className="text-xs underline" disabled={pending} onClick={() => run(() => unmapVoteHeadAction(m.source, m.matchKey))}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
