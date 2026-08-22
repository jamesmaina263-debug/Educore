"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import type { ItemRow } from "@/components/inventory/inventory-section";
import {
  completeAssetMaintenanceAction,
  createAssetAction,
  createPurchaseOrderAction,
  createRequisitionAction,
  createSupplierAction,
  createSupplierInvoiceAction,
  decideRequisitionAction,
  markSupplierInvoicePaidAction,
  receiveGoodsAction,
  requestAssetMaintenanceAction,
  updateAssetStatusAction,
  updatePurchaseOrderItemAction,
} from "@/app/(app)/inventory/actions";

export interface AssetRow {
  id: string;
  name: string;
  category: string | null;
  asset_tag: string | null;
  location: string | null;
  condition: string;
  status: "in_use" | "in_storage" | "under_maintenance" | "disposed";
  purchase_value: number | null;
}
export interface MaintenanceRow {
  id: string;
  asset_id: string;
  asset_name: string;
  description: string;
  status: "requested" | "in_progress" | "completed" | "cancelled";
  request_date: string;
}
export interface SupplierRow {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  category: string | null;
}
export interface RequisitionRow {
  id: string;
  purpose: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "converted";
  created_at: string;
  items: { item_description: string; quantity: number }[];
}
export interface PurchaseOrderRow {
  id: string;
  po_number: string;
  status: "draft" | "sent" | "partially_received" | "received" | "cancelled";
  supplier_name: string;
  order_date: string;
  items: { id: string; item_description: string; quantity: number; quantity_received: number; unit_cost: number | null; inventory_item_id: string | null }[];
}
export interface SupplierInvoiceRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  amount: number;
  status: "pending_payment" | "paid" | "cancelled";
  supplier_name: string;
}

const ASSET_STATUS_TONE: Record<AssetRow["status"], "neutral" | "warning" | "danger" | "success"> = {
  in_use: "success",
  in_storage: "neutral",
  under_maintenance: "warning",
  disposed: "danger",
};
const REQ_STATUS_TONE: Record<RequisitionRow["status"], "neutral" | "warning" | "success" | "danger" | "info"> = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  converted: "success",
};
const PO_STATUS_TONE: Record<PurchaseOrderRow["status"], "neutral" | "warning" | "success" | "info" | "danger"> = {
  draft: "neutral",
  sent: "info",
  partially_received: "warning",
  received: "success",
  cancelled: "danger",
};
const INVOICE_STATUS_TONE: Record<SupplierInvoiceRow["status"], "warning" | "success" | "neutral"> = {
  pending_payment: "warning",
  paid: "success",
  cancelled: "neutral",
};

function useAction() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(fn: (fd: FormData) => Promise<{ error: string } | { success: true }>, formData: FormData, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn(formData);
      if ("error" in res) setError(res.error);
      else onDone?.();
    });
  }
  return { isPending, error, run };
}

export function AssetsPanel({ assets, maintenance, canWrite }: { assets: AssetRow[]; maintenance: MaintenanceRow[]; canWrite: boolean }) {
  const { isPending, error, run } = useAction();
  const [assetOpen, setAssetOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</div>}
      {canWrite && (
        <div className="flex justify-end">
          <Dialog open={assetOpen} onOpenChange={setAssetOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Add Asset</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Asset</DialogTitle>
              </DialogHeader>
              <form className="flex flex-col gap-3" action={(fd) => run(createAssetAction, fd, () => setAssetOpen(false))}>
                <div className="flex flex-col gap-1.5">
                  <Label>Name</Label>
                  <Input name="name" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Category</Label>
                    <Input name="category" placeholder="e.g. electronics, furniture" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Asset Tag</Label>
                    <Input name="asset_tag" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Location</Label>
                    <Input name="location" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Serial Number</Label>
                    <Input name="serial_number" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Purchase Date</Label>
                    <Input type="date" name="purchase_date" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Purchase Value</Label>
                    <Input type="number" step="0.01" name="purchase_value" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isPending}>Save</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Assets</h2>
          <span className="text-[0.6875rem] text-muted-foreground">{assets.length} asset{assets.length === 1 ? "" : "s"}</span>
        </header>
        {assets.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No assets recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Tag</th>
                  <th>Location</th>
                  <th>Condition</th>
                  <th>Status</th>
                  {canWrite && <th></th>}
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium">{a.name}</td>
                    <td className="text-muted-foreground">{a.category ?? "—"}</td>
                    <td className="text-muted-foreground">{a.asset_tag ?? "—"}</td>
                    <td className="text-muted-foreground">{a.location ?? "—"}</td>
                    <td className="text-muted-foreground">{a.condition}</td>
                    <td>
                      <StatusBadge tone={ASSET_STATUS_TONE[a.status]} label={a.status.replace("_", " ")} />
                    </td>
                    {canWrite && (
                      <td>
                        <div className="flex gap-2">
                          {a.status !== "under_maintenance" && a.status !== "disposed" && (
                            <Dialog open={maintenanceOpen === a.id} onOpenChange={(o) => setMaintenanceOpen(o ? a.id : null)}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline">Request Maintenance</Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Request Maintenance — {a.name}</DialogTitle>
                                </DialogHeader>
                                <form className="flex flex-col gap-3" action={(fd) => run(requestAssetMaintenanceAction, fd, () => setMaintenanceOpen(null))}>
                                  <input type="hidden" name="asset_id" value={a.id} />
                                  <div className="flex flex-col gap-1.5">
                                    <Label>Description</Label>
                                    <Textarea name="description" required />
                                  </div>
                                  <DialogFooter>
                                    <Button type="submit" disabled={isPending}>Submit</Button>
                                  </DialogFooter>
                                </form>
                              </DialogContent>
                            </Dialog>
                          )}
                          <Dialog open={statusOpen === a.id} onOpenChange={(o) => setStatusOpen(o ? a.id : null)}>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline">Edit Status</Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Edit Status — {a.name}</DialogTitle>
                              </DialogHeader>
                              <form className="flex flex-col gap-3" action={(fd) => run(updateAssetStatusAction, fd, () => setStatusOpen(null))}>
                                <input type="hidden" name="asset_id" value={a.id} />
                                <div className="flex flex-col gap-1.5">
                                  <Label>Status</Label>
                                  <Select name="status" defaultValue={a.status}>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="in_use">In use</SelectItem>
                                      <SelectItem value="in_storage">In storage</SelectItem>
                                      <SelectItem value="under_maintenance">Under maintenance</SelectItem>
                                      <SelectItem value="disposed">Disposed</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  <Label>Condition</Label>
                                  <Select name="condition" defaultValue={a.condition}>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="excellent">Excellent</SelectItem>
                                      <SelectItem value="good">Good</SelectItem>
                                      <SelectItem value="fair">Fair</SelectItem>
                                      <SelectItem value="poor">Poor</SelectItem>
                                      <SelectItem value="damaged">Damaged</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  For maintenance, prefer &quot;Request Maintenance&quot; so it&apos;s tracked as a record.
                                  Use this for direct changes — disposing an asset, moving it to storage, or correcting
                                  its condition.
                                </p>
                                <DialogFooter>
                                  <Button type="submit" disabled={isPending}>Save</Button>
                                </DialogFooter>
                              </form>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Maintenance</h2>
          <span className="text-[0.6875rem] text-muted-foreground">{maintenance.length} record{maintenance.length === 1 ? "" : "s"}</span>
        </header>
        {maintenance.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No maintenance requests.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Asset</th>
                  <th>Requested</th>
                  <th>Description</th>
                  <th>Status</th>
                  {canWrite && <th></th>}
                </tr>
              </thead>
              <tbody>
                {maintenance.map((m) => (
                  <tr key={m.id}>
                    <td className="font-medium">{m.asset_name}</td>
                    <td className="text-muted-foreground">{m.request_date}</td>
                    <td className="max-w-xs truncate">{m.description}</td>
                    <td>
                      <StatusBadge
                        tone={m.status === "completed" ? "success" : m.status === "cancelled" ? "neutral" : "warning"}
                        label={m.status.replace("_", " ")}
                      />
                    </td>
                    {canWrite && (
                      <td>
                        {m.status !== "completed" && m.status !== "cancelled" && (
                          <form className="flex gap-2" action={(fd) => run(completeAssetMaintenanceAction, fd)}>
                            <input type="hidden" name="record_id" value={m.id} />
                            <input type="hidden" name="asset_id" value={m.asset_id} />
                            <Input name="cost" type="number" step="0.01" placeholder="Cost" className="w-24" />
                            <Button type="submit" size="sm" variant="outline" disabled={isPending}>Mark Complete</Button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function SuppliersPanel({ suppliers, canWrite }: { suppliers: SupplierRow[]; canWrite: boolean }) {
  const { isPending, error, run } = useAction();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</div>}
      {canWrite && (
        <div className="flex justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Add Supplier</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Supplier</DialogTitle>
              </DialogHeader>
              <form className="flex flex-col gap-3" action={(fd) => run(createSupplierAction, fd, () => setOpen(false))}>
                <div className="flex flex-col gap-1.5">
                  <Label>Name</Label>
                  <Input name="name" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Contact Person</Label>
                    <Input name="contact_person" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Category</Label>
                    <Input name="category" placeholder="e.g. stationery, catering" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Phone</Label>
                    <Input name="phone" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Email</Label>
                    <Input type="email" name="email" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isPending}>Save</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}
      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Suppliers</h2>
          <span className="text-[0.6875rem] text-muted-foreground">{suppliers.length} supplier{suppliers.length === 1 ? "" : "s"}</span>
        </header>
        {suppliers.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No suppliers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.name}</td>
                    <td className="text-muted-foreground">{s.category ?? "—"}</td>
                    <td className="text-muted-foreground">{s.contact_person ?? "—"}</td>
                    <td className="text-muted-foreground">{s.phone ?? "—"}</td>
                    <td className="text-muted-foreground">{s.email ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProcurementPanel({
  requisitions,
  purchaseOrders,
  suppliers,
  items,
  canWrite,
  canApprove,
}: {
  requisitions: RequisitionRow[];
  purchaseOrders: PurchaseOrderRow[];
  suppliers: SupplierRow[];
  items: ItemRow[];
  canWrite: boolean;
  canApprove: boolean;
}) {
  const { isPending, error, run } = useAction();
  const [reqOpen, setReqOpen] = useState(false);
  const [poOpen, setPoOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState<string | null>(null);
  const [editItemOpen, setEditItemOpen] = useState<{ id: string; quantity: number; unit_cost: number | null } | null>(null);
  const [poItemMode, setPoItemMode] = useState<string>("__custom__");

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="flex justify-end gap-2">
        {canWrite && (
          <Dialog open={reqOpen} onOpenChange={setReqOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">New Requisition</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Requisition</DialogTitle>
              </DialogHeader>
              <form className="flex flex-col gap-3" action={(fd) => run(createRequisitionAction, fd, () => setReqOpen(false))}>
                <div className="flex flex-col gap-1.5">
                  <Label>Purpose</Label>
                  <Textarea name="purpose" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Item</Label>
                  <Input name="item_description" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Quantity</Label>
                    <Input type="number" step="0.01" name="quantity" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Est. Unit Cost</Label>
                    <Input type="number" step="0.01" name="estimated_unit_cost" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isPending}>Submit</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
        {canApprove && (
          <Dialog
            open={poOpen}
            onOpenChange={(o) => {
              setPoOpen(o);
              if (!o) setPoItemMode("__custom__");
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm">Issue Purchase Order</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Issue Purchase Order</DialogTitle>
              </DialogHeader>
              <form className="flex flex-col gap-3" action={(fd) => run(createPurchaseOrderAction, fd, () => setPoOpen(false))}>
                <div className="flex flex-col gap-1.5">
                  <Label>From Requisition (optional)</Label>
                  <Select name="requisition_id">
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      {requisitions.filter((r) => r.status === "approved").map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.purpose}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Supplier</Label>
                  <Select name="supplier_id" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Expected Date</Label>
                  <Input type="date" name="expected_date" />
                </div>
                <p className="text-[0.6875rem] text-muted-foreground">PO number is generated automatically when this is issued.</p>
                <div className="flex flex-col gap-1.5">
                  <Label>Item</Label>
                  <Select value={poItemMode} onValueChange={setPoItemMode}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a stock item, or enter a custom item below" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__custom__">Custom item (not in stock catalog)</SelectItem>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {poItemMode !== "__custom__" && <input type="hidden" name="inventory_item_id" value={poItemMode} />}
                <div className="flex flex-col gap-1.5">
                  <Label>Item Description</Label>
                  <Input
                    name="item_description"
                    required
                    defaultValue={poItemMode === "__custom__" ? "" : items.find((i) => i.id === poItemMode)?.name ?? ""}
                    key={poItemMode}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Quantity</Label>
                    <Input type="number" step="0.01" name="quantity" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Unit Cost</Label>
                    <Input type="number" step="0.01" name="unit_cost" required />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isPending}>Issue</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Requisitions</h2>
          <span className="text-[0.6875rem] text-muted-foreground">{requisitions.length}</span>
        </header>
        {requisitions.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No requisitions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Purpose</th>
                  <th>Items</th>
                  <th>Status</th>
                  {canApprove && <th></th>}
                </tr>
              </thead>
              <tbody>
                {requisitions.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.purpose}</td>
                    <td className="text-muted-foreground">{r.items.map((i) => `${i.item_description} (${i.quantity})`).join(", ")}</td>
                    <td>
                      <StatusBadge tone={REQ_STATUS_TONE[r.status]} label={r.status} />
                    </td>
                    {canApprove && (
                      <td>
                        {r.status === "submitted" && (
                          <div className="flex gap-2">
                            <form action={(fd) => run(decideRequisitionAction, fd)}>
                              <input type="hidden" name="requisition_id" value={r.id} />
                              <input type="hidden" name="decision" value="approved" />
                              <Button type="submit" size="sm" variant="outline" disabled={isPending}>Approve</Button>
                            </form>
                            <form action={(fd) => run(decideRequisitionAction, fd)}>
                              <input type="hidden" name="requisition_id" value={r.id} />
                              <input type="hidden" name="decision" value="rejected" />
                              <Button type="submit" size="sm" variant="outline" disabled={isPending}>Reject</Button>
                            </form>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Purchase Orders</h2>
          <span className="text-[0.6875rem] text-muted-foreground">{purchaseOrders.length}</span>
        </header>
        {purchaseOrders.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No purchase orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>PO #</th>
                  <th>Supplier</th>
                  <th>Items</th>
                  <th>Status</th>
                  {canWrite && <th></th>}
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((po) => (
                  <tr key={po.id}>
                    <td className="font-medium">{po.po_number}</td>
                    <td className="text-muted-foreground">{po.supplier_name}</td>
                    <td className="text-muted-foreground">
                      <div className="flex flex-col gap-1">
                        {po.items.map((i) => (
                          <div key={i.id} className="flex items-center gap-1.5">
                            <span>{i.item_description} ({i.quantity_received}/{i.quantity})</span>
                            {canApprove && i.quantity_received === 0 && (
                              <button
                                type="button"
                                className="text-[0.6875rem] text-primary underline underline-offset-2"
                                onClick={() => setEditItemOpen({ id: i.id, quantity: i.quantity, unit_cost: i.unit_cost })}
                              >
                                Edit
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <StatusBadge tone={PO_STATUS_TONE[po.status]} label={po.status.replace("_", " ")} />
                    </td>
                    {canWrite && (
                      <td>
                        {po.status !== "received" && po.status !== "cancelled" && (
                          <Dialog open={receiveOpen === po.id} onOpenChange={(o) => setReceiveOpen(o ? po.id : null)}>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline">Receive Goods</Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Receive Goods — {po.po_number}</DialogTitle>
                              </DialogHeader>
                              <form className="flex flex-col gap-3" action={(fd) => run(receiveGoodsAction, fd, () => setReceiveOpen(null))}>
                                <input type="hidden" name="po_id" value={po.id} />
                                <div className="flex flex-col gap-1.5">
                                  <Label>Item</Label>
                                  <Select name="po_item_id" required>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select item" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {po.items.map((i) => (
                                        <SelectItem key={i.id} value={i.id}>
                                          {i.item_description} ({i.quantity_received}/{i.quantity} received)
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  <Label>Quantity Received</Label>
                                  <Input type="number" step="0.01" name="quantity_received" required />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  <Label>Condition Notes</Label>
                                  <Textarea name="condition_notes" />
                                </div>
                                <DialogFooter>
                                  <Button type="submit" disabled={isPending}>Record</Button>
                                </DialogFooter>
                              </form>
                            </DialogContent>
                          </Dialog>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={editItemOpen !== null} onOpenChange={(o) => !o && setEditItemOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Purchase Order Item</DialogTitle>
          </DialogHeader>
          {editItemOpen && (
            <form
              className="flex flex-col gap-3"
              action={(fd) => run(updatePurchaseOrderItemAction, fd, () => setEditItemOpen(null))}
            >
              <input type="hidden" name="po_item_id" value={editItemOpen.id} />
              <div className="flex flex-col gap-1.5">
                <Label>Quantity</Label>
                <Input type="number" step="0.01" name="quantity" defaultValue={editItemOpen.quantity} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Unit Cost</Label>
                <Input type="number" step="0.01" name="unit_cost" defaultValue={editItemOpen.unit_cost ?? undefined} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isPending}>Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SupplierInvoicesPanel({
  invoices,
  suppliers,
  purchaseOrders,
  canWrite,
}: {
  invoices: SupplierInvoiceRow[];
  suppliers: SupplierRow[];
  purchaseOrders: PurchaseOrderRow[];
  canWrite: boolean;
}) {
  const { isPending, error, run } = useAction();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</div>}
      <p className="text-xs text-muted-foreground">
        Tracks the supplier&apos;s invoice document and reference only — the actual payment is recorded in Finance &gt; Expenses.
      </p>
      {canWrite && (
        <div className="flex justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Log Supplier Invoice</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Log Supplier Invoice</DialogTitle>
              </DialogHeader>
              <form className="flex flex-col gap-3" action={(fd) => run(createSupplierInvoiceAction, fd, () => setOpen(false))}>
                <div className="flex flex-col gap-1.5">
                  <Label>Supplier</Label>
                  <Select name="supplier_id" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Related PO (optional)</Label>
                  <Select name="po_id">
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      {purchaseOrders.map((po) => (
                        <SelectItem key={po.id} value={po.id}>{po.po_number}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Invoice Number</Label>
                    <Input name="invoice_number" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Invoice Date</Label>
                    <Input type="date" name="invoice_date" required />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Amount</Label>
                  <Input type="number" step="0.01" name="amount" required />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isPending}>Save</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}
      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Supplier Invoices</h2>
          <span className="text-[0.6875rem] text-muted-foreground">{invoices.length}</span>
        </header>
        {invoices.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No supplier invoices logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Invoice #</th>
                  <th>Supplier</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  {canWrite && <th></th>}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="font-medium">{inv.invoice_number}</td>
                    <td className="text-muted-foreground">{inv.supplier_name}</td>
                    <td className="text-muted-foreground">{inv.invoice_date}</td>
                    <td data-numeric>{inv.amount.toLocaleString()}</td>
                    <td>
                      <StatusBadge tone={INVOICE_STATUS_TONE[inv.status]} label={inv.status.replace("_", " ")} />
                    </td>
                    {canWrite && (
                      <td>
                        {inv.status === "pending_payment" && (
                          <form action={(fd) => run(markSupplierInvoicePaidAction, fd)}>
                            <input type="hidden" name="invoice_id" value={inv.id} />
                            <Button type="submit" size="sm" variant="outline" disabled={isPending}>Mark Paid</Button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
