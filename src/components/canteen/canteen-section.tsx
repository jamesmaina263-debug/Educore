"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { StudentCombobox } from "@/components/shared/student-combobox";
import { formatKes } from "@/lib/billing/format";
import {
  adjustStockAction,
  depositAction,
  refundAction,
  saleAction,
  saveItemAction,
  summaryAction,
  voidSaleAction,
  type Summary,
} from "@/app/(app)/inventory/canteen/actions";
import {
  ENTRY_LABELS,
  addToCart,
  cartTotal,
  ledgerIsConsistent,
  nextClientRef,
  salePayload,
  setQty,
  validateSale,
  type CartLine,
  type LedgerEntryLite,
  type Tender,
} from "@/lib/canteen";

export interface ItemRow {
  id: string;
  name: string;
  price: number;
  stock: number;
  reorderLevel: number;
  active: boolean;
}
export interface WalletRow {
  studentId: string;
  balance: number;
}
export interface StudentRow {
  id: string;
  name: string;
  admission_number?: string;
  class_name?: string;
}
export interface SaleRow {
  id: string;
  studentName: string | null;
  tender: Tender;
  total: number;
  status: "completed" | "voided";
  voidReason: string | null;
  createdAt: string;
  lines: string[];
}
export interface LedgerRow extends LedgerEntryLite {
  id: string;
  studentId: string;
  note: string | null;
  createdAt: string;
}

type Tab = "till" | "items" | "wallets" | "sales";
type Attempt = { ref: string; fingerprint: string } | null;

const makeRef = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(36).slice(2)}`);
const when = (ts: string) => new Date(ts).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });

export function CanteenSection({
  canSell,
  canManage,
  items,
  wallets,
  students,
  sales,
  ledger,
  today,
  initialSummary,
}: {
  canSell: boolean;
  canManage: boolean;
  items: ItemRow[];
  wallets: WalletRow[];
  students: StudentRow[];
  sales: SaleRow[];
  ledger: LedgerRow[];
  today: string;
  initialSummary: Summary | null;
}) {
  const [tab, setTab] = useState<Tab>(canSell ? "till" : "sales");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Till
  const [studentId, setStudentId] = useState("");
  const [tender, setTender] = useState<Tender>("wallet");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saleAttempt, setSaleAttempt] = useState<Attempt>(null);

  // Items
  const [itemForm, setItemForm] = useState<{ id: string | null; name: string; price: string; reorderLevel: string; active: boolean } | null>(null);
  const [stockFor, setStockFor] = useState<{ id: string; delta: string; reason: "received" | "adjustment"; note: string } | null>(null);

  // Wallets
  const [walletStudent, setWalletStudent] = useState("");
  const [amount, setAmount] = useState("");
  const [moneyNote, setMoneyNote] = useState("");
  const [moneyAttempt, setMoneyAttempt] = useState<Attempt>(null);

  // Sales
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  const [range, setRange] = useState({ from: today, to: today });
  const [summary, setSummary] = useState<Summary | null>(initialSummary);

  const balanceOf = (id: string) => wallets.find((w) => w.studentId === id)?.balance ?? 0;
  const sellable = items.filter((i) => i.active && i.stock > 0);

  async function run<T>(fn: () => Promise<{ error: string } | ({ success: true } & T)>, ok: (r: { success: true } & T) => string, after?: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      if ("error" in r) setError(r.error);
      else {
        setNotice(ok(r));
        after?.();
      }
    } finally {
      setBusy(false);
    }
  }

  function charge() {
    const check = validateSale({ studentId, tender, cart, walletBalance: tender === "wallet" ? balanceOf(studentId) : null });
    if ("error" in check) {
      setError(check.error);
      return;
    }
    // The same reference is reused while nothing has changed, so retrying after a dropped connection cannot charge twice.
    const attempt = nextClientRef(saleAttempt, JSON.stringify({ studentId, tender, cart: salePayload(cart) }), makeRef);
    setSaleAttempt(attempt);
    void run(
      () => saleAction(studentId, tender, salePayload(cart), attempt.ref),
      (r) => {
        const res = (r as unknown as { result: { total: number; balance: number | null; duplicate: boolean } }).result;
        return `${res.duplicate ? "Already recorded: " : "Sale recorded: "}${formatKes(res.total)}${res.balance !== null ? `. Wallet balance now ${formatKes(res.balance)}.` : " (cash)."}`;
      },
      () => {
        setCart([]);
        setSaleAttempt(null);
      },
    );
  }

  function submitMoney(kind: "deposit" | "refund") {
    const fingerprint = JSON.stringify({ kind, walletStudent, amount, moneyNote });
    const attempt = nextClientRef(moneyAttempt, fingerprint, makeRef);
    setMoneyAttempt(attempt);
    const fn = kind === "deposit" ? depositAction : refundAction;
    void run(
      () => fn(walletStudent, amount, moneyNote, attempt.ref),
      (r) => {
        const res = (r as unknown as { result: { balance: number; amount: number; duplicate: boolean } }).result;
        return `${res.duplicate ? "Already recorded. " : kind === "deposit" ? `${formatKes(res.amount)} added. ` : `${formatKes(res.amount)} paid out. `}Balance is ${formatKes(res.balance)}.`;
      },
      () => {
        setAmount("");
        setMoneyNote("");
        setMoneyAttempt(null);
      },
    );
  }

  const walletEntries = ledger.filter((e) => e.studentId === walletStudent);
  const walletEntriesOldestFirst = [...walletEntries].reverse();
  const consistent = walletEntries.length === 0 || ledgerIsConsistent(walletEntriesOldestFirst);
  const tabs: [Tab, string, boolean][] = [["till", "Till", canSell], ["items", "Items and stock", true], ["wallets", "Wallets", true], ["sales", "Sales and summary", true]];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Canteen</h1>
        <p className="text-sm text-muted-foreground">
          Sell from the canteen to a student&apos;s wallet or for cash. Money added to a wallet and money paid back out are cash that staff
          hand over and record here. Nothing is charged online and nothing here changes fee balances or receipts.
        </p>
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md border p-2 text-sm">{notice}</p>}

      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.filter(([, , show]) => show).map(([t, label]) => (
          <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => { setTab(t); setError(null); setNotice(null); }}>{label}</Button>
        ))}
      </div>

      {tab === "till" && canSell && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-4">
            <p className="mb-2 text-sm font-semibold">Items</p>
            {sellable.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in stock to sell. Add items and receive stock first.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sellable.map((i) => (
                  <Button key={i.id} variant="outline" className="h-auto flex-col items-start py-2 text-left" onClick={() => setCart(addToCart(cart, { id: i.id, name: i.name, price: i.price, stock: i.stock }))}>
                    <span className="text-sm font-medium">{i.name}</span>
                    <span className="text-xs text-muted-foreground">{formatKes(i.price)} · {i.stock} left</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="panel flex flex-col gap-3 p-4">
            <p className="text-sm font-semibold">Sale</p>
            <div className="flex gap-4 text-sm" role="radiogroup" aria-label="How is it being paid">
              {(["wallet", "cash"] as const).map((t) => (
                <label key={t} className="flex items-center gap-2">
                  <input type="radio" name="tender" checked={tender === t} onChange={() => setTender(t)} />
                  {t === "wallet" ? "Student wallet" : "Cash"}
                </label>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>{tender === "wallet" ? "Student" : "Student (optional)"}</Label>
              <StudentCombobox students={students} value={studentId} onChange={setStudentId} placeholder="Search by name or admission number..." />
              {tender === "wallet" && studentId && <p className="text-xs text-muted-foreground">Wallet balance: {formatKes(balanceOf(studentId))}</p>}
            </div>
            {cart.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tap an item to add it.</p>
            ) : (
              <ul className="divide-y">
                {cart.map((l) => (
                  <li key={l.itemId} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 truncate">{l.name} <span className="text-muted-foreground">{formatKes(l.price)}</span></span>
                    <span className="flex items-center gap-2">
                      <Input aria-label={`Quantity of ${l.name}`} className="w-16" type="number" min={0} max={l.stock} value={l.qty} onChange={(e) => setCart(setQty(cart, l.itemId, Number(e.target.value)))} />
                      <span className="w-20 text-right">{formatKes(l.price * l.qty)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-base font-semibold">Total: {formatKes(cartTotal(cart))}</p>
            <div className="flex gap-2">
              <Button disabled={busy || cart.length === 0} onClick={charge}>{busy ? "Recording..." : tender === "wallet" ? "Charge wallet" : "Record cash sale"}</Button>
              <Button variant="outline" disabled={busy || cart.length === 0} onClick={() => { setCart([]); setSaleAttempt(null); }}>Clear</Button>
            </div>
          </div>
        </div>
      )}

      {tab === "items" && (
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">Price list and stock</p>
            {canManage && !itemForm && <Button size="sm" onClick={() => setItemForm({ id: null, name: "", price: "", reorderLevel: "", active: true })}>New item</Button>}
          </div>
          {itemForm && (
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2"><Label htmlFor="i-name">Name</Label><Input id="i-name" value={itemForm.name} maxLength={80} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} /></div>
              <div><Label htmlFor="i-price">Price (KES)</Label><Input id="i-price" inputMode="decimal" value={itemForm.price} onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })} /></div>
              <div><Label htmlFor="i-reorder">Reorder at</Label><Input id="i-reorder" inputMode="numeric" value={itemForm.reorderLevel} onChange={(e) => setItemForm({ ...itemForm, reorderLevel: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" checked={itemForm.active} onChange={(e) => setItemForm({ ...itemForm, active: e.target.checked })} /> On sale</label>
              <div className="flex gap-2 sm:col-span-4">
                <Button disabled={busy} onClick={() => run(() => saveItemAction(itemForm), () => "Item saved.", () => setItemForm(null))}>{busy ? "Saving..." : "Save item"}</Button>
                <Button variant="outline" disabled={busy} onClick={() => setItemForm(null)}>Close</Button>
              </div>
            </div>
          )}
          {stockFor && (
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <p className="text-sm font-medium sm:col-span-4">Stock for {items.find((i) => i.id === stockFor.id)?.name}</p>
              <div>
                <Label htmlFor="s-reason">What happened</Label>
                <select id="s-reason" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={stockFor.reason} onChange={(e) => setStockFor({ ...stockFor, reason: e.target.value as "received" | "adjustment" })}>
                  <option value="received">Stock received</option>
                  {canManage && <option value="adjustment">Correction (spoiled, lost, miscounted)</option>}
                </select>
              </div>
              <div><Label htmlFor="s-delta">Quantity{stockFor.reason === "adjustment" ? " (+ or -)" : ""}</Label><Input id="s-delta" inputMode="numeric" value={stockFor.delta} onChange={(e) => setStockFor({ ...stockFor, delta: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label htmlFor="s-note">Note{stockFor.reason === "adjustment" ? " (required)" : ""}</Label><Input id="s-note" maxLength={200} value={stockFor.note} onChange={(e) => setStockFor({ ...stockFor, note: e.target.value })} /></div>
              <div className="flex gap-2 sm:col-span-4">
                <Button disabled={busy} onClick={() => run(() => adjustStockAction(stockFor.id, stockFor.delta, stockFor.reason, stockFor.note), () => "Stock updated.", () => setStockFor(null))}>{busy ? "Saving..." : "Save stock"}</Button>
                <Button variant="outline" disabled={busy} onClick={() => setStockFor(null)}>Close</Button>
              </div>
            </div>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet.{canManage ? " Add the first one." : ""}</p>
          ) : (
            <ul className="divide-y">
              {items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{i.name} <span className="text-muted-foreground">{formatKes(i.price)}</span></p>
                    <p className="text-xs text-muted-foreground">{i.stock} in stock{i.reorderLevel > 0 ? ` · reorder at ${i.reorderLevel}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {i.active && i.stock <= i.reorderLevel && <StatusBadge tone="warning" label="Low stock" />}
                    {!i.active && <StatusBadge tone="neutral" label="Not on sale" />}
                    {canSell && <Button size="sm" variant="outline" onClick={() => setStockFor({ id: i.id, delta: "", reason: "received", note: "" })}>Stock</Button>}
                    {canManage && <Button size="sm" variant="outline" onClick={() => setItemForm({ id: i.id, name: i.name, price: String(i.price), reorderLevel: String(i.reorderLevel), active: i.active })}>Edit</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "wallets" && (
        <div className="panel flex flex-col gap-4 p-4">
          <div className="space-y-1.5">
            <Label>Student</Label>
            <StudentCombobox students={students} value={walletStudent} onChange={(id) => { setWalletStudent(id); setMoneyAttempt(null); }} placeholder="Search by name or admission number..." />
          </div>
          {walletStudent && (
            <>
              <p className="text-base font-semibold">Balance: {formatKes(balanceOf(walletStudent))}</p>
              {!consistent && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">This wallet&apos;s history does not add up to its balance. Do not add or pay out money; tell support.</p>}
              {canSell && (
                <div className="grid gap-3 sm:grid-cols-4">
                  <div><Label htmlFor="m-amount">Amount (KES)</Label><Input id="m-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  <div className="sm:col-span-3"><Label htmlFor="m-note">Note{canManage ? " (required for a payout)" : ""}</Label><Input id="m-note" maxLength={200} value={moneyNote} onChange={(e) => setMoneyNote(e.target.value)} /></div>
                  <div className="flex flex-wrap gap-2 sm:col-span-4">
                    <Button disabled={busy || !consistent} onClick={() => submitMoney("deposit")}>Add money (cash received)</Button>
                    {canManage && <Button variant="outline" disabled={busy || !consistent} onClick={() => submitMoney("refund")}>Pay out (cash returned)</Button>}
                  </div>
                </div>
              )}
              {walletEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No wallet activity yet.</p>
              ) : (
                <ul className="divide-y">
                  {walletEntries.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>{ENTRY_LABELS[e.kind]}{e.note ? <span className="text-muted-foreground"> · {e.note}</span> : null}<br /><span className="text-xs text-muted-foreground">{when(e.createdAt)}</span></span>
                      <span className="text-right">{e.amount > 0 ? "+" : "-"}{formatKes(Math.abs(e.amount))}<br /><span className="text-xs text-muted-foreground">balance {formatKes(e.balanceAfter)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {tab === "sales" && (
        <div className="flex flex-col gap-4">
          <div className="panel p-4">
            <p className="mb-2 text-sm font-semibold">Summary</p>
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <div><Label htmlFor="sm-from">From</Label><Input id="sm-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
              <div><Label htmlFor="sm-to">To</Label><Input id="sm-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
              <Button size="sm" disabled={busy} onClick={() => void run(() => summaryAction(range.from, range.to), (r) => {
                setSummary((r as unknown as { summary: Summary }).summary);
                return "Summary updated.";
              })}>Show</Button>
            </div>
            {summary ? (
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Sales</dt><dd className="font-medium">{summary.sales_count}</dd></div>
                <div><dt className="text-muted-foreground">Paid from wallets</dt><dd className="font-medium">{formatKes(summary.wallet_sales)}</dd></div>
                <div><dt className="text-muted-foreground">Cash sales</dt><dd className="font-medium">{formatKes(summary.cash_sales)}</dd></div>
                <div><dt className="text-muted-foreground">Voided</dt><dd className="font-medium">{summary.voided_count} ({formatKes(summary.voided_total)})</dd></div>
                <div><dt className="text-muted-foreground">Money added to wallets</dt><dd className="font-medium">{formatKes(summary.deposits)}</dd></div>
                <div><dt className="text-muted-foreground">Paid back out</dt><dd className="font-medium">{formatKes(summary.refunds)}</dd></div>
                <div><dt className="text-muted-foreground">Owed to families (all wallets)</dt><dd className="font-medium">{formatKes(summary.wallet_liability)}</dd></div>
                <div><dt className="text-muted-foreground">Low stock</dt><dd className="font-medium">{summary.low_stock.length === 0 ? "None" : summary.low_stock.map((x) => x.name).join(", ")}</dd></div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Choose dates and press Show.</p>
            )}
          </div>
          <div className="panel p-4">
            <p className="mb-2 text-sm font-semibold">Recent sales</p>
            {sales.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales yet.</p>
            ) : (
              <ul className="divide-y">
                {sales.map((s) => (
                  <li key={s.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{formatKes(s.total)} · {s.tender === "wallet" ? "wallet" : "cash"}{s.studentName ? ` · ${s.studentName}` : ""}</p>
                        <p className="text-xs text-muted-foreground">{s.lines.join(", ")} · {when(s.createdAt)}</p>
                        {s.status === "voided" && <p className="text-xs text-muted-foreground">Voided: {s.voidReason}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {s.status === "voided" && <StatusBadge tone="neutral" label="Voided" />}
                        {canManage && s.status === "completed" && <Button size="sm" variant="outline" onClick={() => setVoiding({ id: s.id, reason: "" })}>Void</Button>}
                      </div>
                    </div>
                    {voiding?.id === s.id && (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <div className="grow"><Label htmlFor="v-reason">Reason for the void</Label><Input id="v-reason" maxLength={200} value={voiding.reason} onChange={(e) => setVoiding({ id: s.id, reason: e.target.value })} /></div>
                        <Button size="sm" disabled={busy} onClick={() => run(() => voidSaleAction(s.id, voiding.reason), () => "Sale voided. Stock and any wallet money have been put back.", () => setVoiding(null))}>Confirm void</Button>
                        <Button size="sm" variant="outline" onClick={() => setVoiding(null)}>Cancel</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
