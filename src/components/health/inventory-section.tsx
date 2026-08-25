"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addMedicalInventoryItem, issueMedicalStock, acceptTransferAction, rejectTransferAction, requestMedicalSuppliesAction, requestHealthStockAdjustmentAction } from "@/app/(app)/health/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export interface MedicalItemRow {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  reorder_level: number | null;
  expiry_date: string | null;
}

export interface PendingTransferRow {
  id: string;
  item_name: string;
  unit: string;
  quantity_requested: number;
  initiated_at: string;
}

export interface MyRequisitionRow {
  id: string;
  purpose: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "converted";
  created_at: string;
  items: { item_description: string; quantity: number }[];
}

export interface MyStockRequestRow {
  id: string;
  item_name: string;
  unit: string;
  quantity: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  rejection_reason: string | null;
}

export function InventorySection({
  items,
  medicalCategoryId,
  pendingTransfers,
  canWrite,
  canRequestSupplies,
  myRequisitions,
  myStockRequests,
}: {
  items: MedicalItemRow[];
  medicalCategoryId: string | null;
  pendingTransfers: PendingTransferRow[];
  canWrite: boolean;
  canRequestSupplies: boolean;
  myRequisitions: MyRequisitionRow[];
  myStockRequests: MyStockRequestRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [form, setForm] = useState({ name: "", unit: "pieces", reorder_level: "", expiry_date: "" });
  const [rejectReason, setRejectReason] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestPending, setRequestPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestPurpose, setRequestPurpose] = useState("");
  const [requestLines, setRequestLines] = useState([
    { item_mode: "", item_description: "", quantity: "", estimated_unit_cost: "" },
  ]);
  const [stockRequestOpen, setStockRequestOpen] = useState(false);
  const [stockRequestPending, setStockRequestPending] = useState(false);
  const [stockRequestError, setStockRequestError] = useState<string | null>(null);
  const [stockRequestItemId, setStockRequestItemId] = useState("");
  const [stockRequestQty, setStockRequestQty] = useState("");
  const [stockRequestReason, setStockRequestReason] = useState("");

  // Date.now() here only sets a display threshold (expiring-soon cutoff), recomputed once per
  // mount via the empty deps array. The React-compiler-approved fix (moving this into a
  // useEffect) would introduce a real regression: expired/expiring badges would flash from
  // "not shown" to "shown" a beat after every mount, since today/thirtyDaysOut would start
  // undefined. Not worth that trade for a cosmetic cutoff with no correctness requirement
  // finer than "the current day".
  const { today, thirtyDaysOut } = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- see comment above useMemo
    const now = Date.now();
    return {
      today: new Date(now).toISOString().slice(0, 10),
      thirtyDaysOut: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    };
  }, []);

  async function submit() {
    if (!medicalCategoryId) {
      setError("Medical Supplies category not found.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await addMedicalInventoryItem({
      name: form.name,
      unit: form.unit,
      reorder_level: form.reorder_level ? Number(form.reorder_level) : undefined,
      expiry_date: form.expiry_date || undefined,
      medicalCategoryId,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setForm({ name: "", unit: "pieces", reorder_level: "", expiry_date: "" });
    router.refresh();
  }

  async function issue(itemId: string) {
    const qty = Number(adjustQty);
    if (!qty || qty <= 0) return;
    setPending(true);
    const result = await issueMedicalStock(itemId, qty);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setAdjustingId(null);
    setAdjustQty("");
    router.refresh();
  }

  async function accept(transferId: string, quantityRequested: number) {
    setPending(true);
    setError(null);
    const result = await acceptTransferAction(transferId, quantityRequested);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function reject(transferId: string) {
    if (!rejectReason.trim()) return;
    setPending(true);
    setError(null);
    const result = await rejectTransferAction(transferId, rejectReason);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setRejectingId(null);
    setRejectReason("");
    router.refresh();
  }

  function updateRequestLine(
    index: number,
    patch: Partial<{ item_mode: string; item_description: string; quantity: string; estimated_unit_cost: string }>,
  ) {
    setRequestLines((lines) => lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function selectRequestLineItem(index: number, itemMode: string) {
    const catalogItem = items.find((it) => it.id === itemMode);
    updateRequestLine(index, { item_mode: itemMode, item_description: catalogItem ? catalogItem.name : "" });
  }
  function addRequestLine() {
    setRequestLines((lines) => [...lines, { item_mode: "", item_description: "", quantity: "", estimated_unit_cost: "" }]);
  }
  function removeRequestLine(index: number) {
    setRequestLines((lines) => (lines.length > 1 ? lines.filter((_, i) => i !== index) : lines));
  }
  function resetRequestForm() {
    setRequestPurpose("");
    setRequestLines([{ item_mode: "", item_description: "", quantity: "", estimated_unit_cost: "" }]);
  }

  const validRequestLines = requestLines.filter((l) => l.item_mode && l.item_description.trim() && Number(l.quantity) > 0);

  async function submitRequest() {
    if (!requestPurpose.trim() || validRequestLines.length === 0) return;
    setRequestPending(true);
    setRequestError(null);
    const result = await requestMedicalSuppliesAction({
      purpose: requestPurpose,
      items: validRequestLines.map((l) => ({
        item_description: l.item_description,
        quantity: Number(l.quantity),
        estimated_unit_cost: l.estimated_unit_cost ? Number(l.estimated_unit_cost) : undefined,
        inventory_item_id: l.item_mode,
      })),
    });
    setRequestPending(false);
    if ("error" in result) return setRequestError(result.error);
    setRequestOpen(false);
    resetRequestForm();
    router.refresh();
  }

  async function submitStockRequest() {
    const qty = Number(stockRequestQty);
    if (!stockRequestItemId || !qty || qty <= 0 || !stockRequestReason.trim()) return;
    setStockRequestPending(true);
    setStockRequestError(null);
    const result = await requestHealthStockAdjustmentAction({
      item_id: stockRequestItemId,
      quantity: qty,
      reason: stockRequestReason,
    });
    setStockRequestPending(false);
    if ("error" in result) return setStockRequestError(result.error);
    setStockRequestOpen(false);
    setStockRequestItemId("");
    setStockRequestQty("");
    setStockRequestReason("");
    router.refresh();
  }

  const requisitionStatusTone: Record<MyRequisitionRow["status"], "success" | "warning" | "danger"> = {
    draft: "warning",
    submitted: "warning",
    approved: "success",
    converted: "success",
    rejected: "danger",
  };
  const requisitionStatusLabel: Record<MyRequisitionRow["status"], string> = {
    draft: "Draft",
    submitted: "Pending approval",
    approved: "Approved",
    converted: "Ordered from supplier",
    rejected: "Rejected",
  };
  const stockRequestStatusTone: Record<MyStockRequestRow["status"], "success" | "warning" | "danger"> = {
    pending: "warning",
    approved: "success",
    rejected: "danger",
  };
  const stockRequestStatusLabel: Record<MyStockRequestRow["status"], string> = {
    pending: "Pending approval",
    approved: "Approved",
    rejected: "Rejected",
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Your own stock, separate from Main Store — it only grows when you accept a transfer
        below. Full stock history (including Main Store&apos;s own) is on the{" "}
        <a href="/inventory" className="underline">
          Inventory
        </a>{" "}
        page.
      </p>

      {canWrite && pendingTransfers.length > 0 && (
        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-medium">Incoming transfers</p>
            <span className="text-[0.6875rem] text-muted-foreground">
              {pendingTransfers.length} pending
            </span>
          </header>
          <div className="divide-y divide-border">
            {pendingTransfers.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {t.item_name} — {t.quantity_requested} {t.unit} requested
                  </p>
                  <p className="text-xs text-muted-foreground">Sent {new Date(t.initiated_at).toLocaleDateString()}</p>
                </div>
                {rejectingId === t.id ? (
                  <div className="flex items-center gap-1">
                    <Input
                      className="h-8 w-40"
                      placeholder="Reason"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <Button size="sm" variant="destructive" onClick={() => reject(t.id)} disabled={pending}>
                      Confirm reject
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejectingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => accept(t.id, t.quantity_requested)} disabled={pending}>
                      Accept
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejectingId(t.id)} disabled={pending}>
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {canRequestSupplies && (
        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-medium">Request supplies</p>
            <Dialog
              open={requestOpen}
              onOpenChange={(next) => {
                setRequestOpen(next);
                if (!next) resetRequestForm();
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  New request
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Request medical supplies</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Goes to whoever can approve procurement (owner/principal/deputy). Once
                    approved, the supplier is emailed automatically. Delivery is received at
                    Main Store, then transferred to you here — the same as any other transfer.
                    Add as many items as you need in one request.
                  </p>
                  <div className="space-y-2">
                    {requestLines.map((line, i) => (
                      <div key={i} className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2">
                        <Select value={line.item_mode} onValueChange={(v) => selectRequestLineItem(i, v)}>
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Select a supply" />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map((it) => (
                              <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      <div className="flex items-start gap-2">
                        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
                          <Input
                            placeholder="Item needed"
                            value={line.item_description}
                            readOnly
                            className="bg-muted"
                          />
                          <Input
                            type="number"
                            min={1}
                            placeholder="Qty"
                            className="sm:w-24"
                            value={line.quantity}
                            onChange={(e) => updateRequestLine(i, { quantity: e.target.value })}
                          />
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Est. cost"
                            className="sm:w-28"
                            value={line.estimated_unit_cost}
                            onChange={(e) => updateRequestLine(i, { estimated_unit_cost: e.target.value })}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeRequestLine(i)}
                          disabled={requestLines.length === 1}
                          className="mt-1.5 px-1 text-sm text-muted-foreground hover:text-danger disabled:opacity-30"
                          aria-label="Remove item"
                        >
                          ×
                        </button>
                      </div>
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="ghost" onClick={addRequestLine}>
                      + Add another item
                    </Button>
                  </div>
                  <Input placeholder="Reason / purpose" value={requestPurpose} onChange={(e) => setRequestPurpose(e.target.value)} />
                  {requestError && <p className="text-sm text-danger">{requestError}</p>}
                </div>
                <DialogFooter>
                  <Button onClick={submitRequest} disabled={requestPending || !requestPurpose.trim() || validRequestLines.length === 0}>
                    {requestPending ? "Submitting…" : "Submit request"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </header>
          <div className="divide-y divide-border">
            {myRequisitions.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {r.items.map((it) => `${it.item_description} — ${it.quantity}`).join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.purpose} · {new Date(r.created_at).toLocaleDateString()}
                  </p>
                </div>
                <StatusBadge tone={requisitionStatusTone[r.status]} label={requisitionStatusLabel[r.status]} />
              </div>
            ))}
            {myRequisitions.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No requests yet.</p>}
          </div>
        </div>
      )}

      {canWrite && (
        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-medium">Add stock manually</p>
            <Dialog
              open={stockRequestOpen}
              onOpenChange={(next) => {
                setStockRequestOpen(next);
                if (!next) {
                  setStockRequestItemId("");
                  setStockRequestQty("");
                  setStockRequestReason("");
                  setStockRequestError(null);
                }
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  Request addition
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Request manual stock addition</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    For stock you&apos;re physically holding that didn&apos;t come through a Main Store
                    transfer (e.g. a donation). Goes to whoever can approve procurement
                    (owner/principal/deputy) before it&apos;s added to your count.
                  </p>
                  <Select value={stockRequestItemId} onValueChange={setStockRequestItemId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select item" />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="number" min={1} placeholder="Quantity" value={stockRequestQty} onChange={(e) => setStockRequestQty(e.target.value)} />
                  <Input placeholder="Reason (e.g. donation from...)" value={stockRequestReason} onChange={(e) => setStockRequestReason(e.target.value)} />
                  {stockRequestError && <p className="text-sm text-danger">{stockRequestError}</p>}
                </div>
                <DialogFooter>
                  <Button
                    onClick={submitStockRequest}
                    disabled={stockRequestPending || !stockRequestItemId || !stockRequestQty || !stockRequestReason.trim()}
                  >
                    {stockRequestPending ? "Submitting…" : "Submit request"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </header>
          <div className="divide-y divide-border">
            {myStockRequests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {r.item_name} — {r.quantity} {r.unit}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.reason} · {new Date(r.created_at).toLocaleDateString()}
                    {r.status === "rejected" && r.rejection_reason ? ` · ${r.rejection_reason}` : ""}
                  </p>
                </div>
                <StatusBadge tone={stockRequestStatusTone[r.status]} label={stockRequestStatusLabel[r.status]} />
              </div>
            ))}
            {myStockRequests.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No requests yet.</p>}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {canWrite && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="self-start">
              Add medical item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New medical inventory item</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Item name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input placeholder="Unit (e.g. tablets, ml)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
                <Input type="number" min={0} placeholder="Reorder level" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} />
              </div>
              <Input type="date" placeholder="Expiry date (optional)" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
              {error && <p className="text-sm text-danger">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={pending || !form.name}>
                {pending ? "Adding…" : "Add item"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead>
            <tr>
              <th className="text-left">Item</th>
              <th className="text-left">Quantity</th>
              <th className="text-left">Expiry</th>
              <th className="text-left">Status</th>
              {canWrite && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const low = i.reorder_level !== null && i.quantity <= i.reorder_level;
              const expired = i.expiry_date && i.expiry_date < today;
              const expiringSoon = i.expiry_date && !expired && i.expiry_date <= thirtyDaysOut;
              return (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>
                    {i.quantity} {i.unit}
                  </td>
                  <td>{i.expiry_date ?? "—"}</td>
                  <td className="flex flex-wrap gap-1">
                    {low && <StatusBadge tone="warning" label="Low stock" />}
                    {expired && <StatusBadge tone="danger" label="Expired" />}
                    {expiringSoon && <StatusBadge tone="warning" label="Expiring soon" />}
                    {!low && !expired && !expiringSoon && <StatusBadge tone="success" label="OK" />}
                  </td>
                  {canWrite && (
                    <td>
                      {adjustingId === i.id ? (
                        <div className="flex items-center gap-1">
                          <Input className="h-8 w-16" type="number" min={1} value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} />
                          <Button size="sm" variant="outline" onClick={() => issue(i.id)} disabled={pending}>
                            Issue
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setAdjustingId(i.id)}>
                          Issue stock
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  No medical inventory items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
