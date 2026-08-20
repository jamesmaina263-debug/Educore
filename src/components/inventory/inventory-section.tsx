"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createInventoryItemAction, createCategoryAction, recordStockMovementAction, createTransferAction } from "@/app/(app)/inventory/actions";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { queueMutation } from "@/lib/offline/queue";
import { InventoryOfflineBanner } from "./offline-banner";

export interface ItemRow {
  id: string;
  name: string;
  category_name: string | null;
  unit: string;
  quantity: number;
  reorder_level: number | null;
  location: string | null;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export interface MovementRow {
  id: string;
  item_name: string;
  movement_type: "in" | "out";
  quantity: number;
  reason: string | null;
  moved_at: string;
  actor_name: string | null;
}

export interface TransferRow {
  id: string;
  item_name: string;
  unit: string;
  quantity_requested: number;
  quantity_confirmed: number | null;
  status: "pending" | "accepted" | "rejected";
  initiated_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
}

export function InventorySection({
  items,
  categories,
  movements,
  transfers,
  canWrite,
}: {
  items: ItemRow[];
  categories: CategoryOption[];
  movements: MovementRow[];
  transfers: TransferRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { online, pendingCount, failed, syncing, sync, discard } = useOfflineSync("inventory");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [itemOpen, setItemOpen] = useState(false);
  const [itemName, setItemName] = useState("");
  const [unit, setUnit] = useState("pieces");
  const [reorderLevel, setReorderLevel] = useState("");
  const [location, setLocation] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [categoryOpen, setCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveItemId, setMoveItemId] = useState("");
  const [moveType, setMoveType] = useState<"in" | "out">("in");
  const [moveQuantity, setMoveQuantity] = useState("");
  const [moveReason, setMoveReason] = useState("");

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferItemId, setTransferItemId] = useState("");
  const [transferQuantity, setTransferQuantity] = useState("");

  async function handleCreateItem() {
    setPending(true);
    setError(null);
    const result = await createInventoryItemAction({
      name: itemName,
      unit,
      reorder_level: reorderLevel ? Number(reorderLevel) : undefined,
      location,
      category_id: categoryId || undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setItemOpen(false);
    setItemName("");
    setUnit("pieces");
    setReorderLevel("");
    setLocation("");
    setCategoryId("");
    router.refresh();
  }

  async function handleCreateCategory() {
    setPending(true);
    setError(null);
    const result = await createCategoryAction(newCategoryName);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setCategoryOpen(false);
    setNewCategoryName("");
    router.refresh();
  }

  async function handleRecordMovement() {
    setPending(true);
    setError(null);
    const input = {
      item_id: moveItemId,
      movement_type: moveType,
      quantity: Number(moveQuantity),
      reason: moveReason,
    };
    if (!online) {
      await queueMutation("inventory", "recordStockMovementAction", input);
      setPending(false);
      setMoveOpen(false);
      setMoveItemId("");
      setMoveQuantity("");
      setMoveReason("");
      return;
    }
    const result = await recordStockMovementAction(input);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setMoveOpen(false);
    setMoveItemId("");
    setMoveQuantity("");
    setMoveReason("");
    router.refresh();
  }

  async function handleCreateTransfer() {
    setPending(true);
    setError(null);
    const result = await createTransferAction({ item_id: transferItemId, quantity: Number(transferQuantity) });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setTransferOpen(false);
    setTransferItemId("");
    setTransferQuantity("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <InventoryOfflineBanner online={online} pendingCount={pendingCount} failed={failed} syncing={syncing} sync={sync} discard={discard} />
      {error && <p className="text-sm text-danger">{error}</p>}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Dialog open={categoryOpen} onOpenChange={setCategoryOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Add category
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a category</DialogTitle>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Furniture, Lab equipment…" />
              </div>
              <DialogFooter>
                <Button onClick={handleCreateCategory} disabled={pending || !newCategoryName}>
                  {pending ? "Adding…" : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={itemOpen} onOpenChange={setItemOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Add item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add an inventory item</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={itemName} onChange={(e) => setItemName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Unit</Label>
                    <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pieces, sets, boxes…" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Reorder level (optional)</Label>
                    <Input type="number" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Category (optional)</Label>
                    <Select value={categoryId} onValueChange={setCategoryId}>
                      <SelectTrigger>
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Location</Label>
                    <Input value={location} onChange={(e) => setLocation(e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">New items start at 0 — record a stock-in movement to add quantity.</p>
              </div>
              <DialogFooter>
                <Button onClick={handleCreateItem} disabled={pending || !itemName}>
                  {pending ? "Adding…" : "Add item"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Record stock movement</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record a stock movement</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Item</Label>
                  <Select value={moveItemId} onValueChange={setMoveItemId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select item" />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name} ({i.quantity} {i.unit} in stock)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Direction</Label>
                    <Select value={moveType} onValueChange={(v) => setMoveType(v as "in" | "out")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in">Stock in</SelectItem>
                        <SelectItem value="out">Stock out</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Quantity</Label>
                    <Input type="number" min={1} value={moveQuantity} onChange={(e) => setMoveQuantity(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Input value={moveReason} onChange={(e) => setMoveReason(e.target.value)} placeholder="New procurement, issued to classroom…" />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleRecordMovement} disabled={pending || !moveItemId || !moveQuantity}>
                  {pending ? "Recording…" : "Record"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Transfer to Health
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transfer stock to Health</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Item</Label>
                  <Select value={transferItemId} onValueChange={setTransferItemId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select item" />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name} ({i.quantity} {i.unit} in stock)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input type="number" min={1} value={transferQuantity} onChange={(e) => setTransferQuantity(e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground">
                  This doesn&apos;t move stock yet — the Nurse confirms what she physically received before it leaves Main Store&apos;s count.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={handleCreateTransfer} disabled={pending || !transferItemId || !transferQuantity}>
                  {pending ? "Sending…" : "Send transfer"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Items</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </header>
        {items.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No items yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const low = i.reorder_level !== null && i.quantity <= i.reorder_level;
                  return (
                    <tr key={i.id}>
                      <td className="font-medium">{i.name}</td>
                      <td className="text-muted-foreground">{i.category_name ?? "—"}</td>
                      <td className="text-muted-foreground">{i.location ?? "—"}</td>
                      <td>
                        <StatusBadge
                          tone={low ? "warning" : "neutral"}
                          label={`${i.quantity} ${i.unit}${low ? " · low stock" : ""}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Recent movements</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {movements.length} movement{movements.length === 1 ? "" : "s"}
          </span>
        </header>
        {movements.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No movements yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Item</th>
                  <th>Direction</th>
                  <th>Quantity</th>
                  <th>Reason</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="font-medium">{m.item_name}</td>
                    <td>
                      <StatusBadge
                        tone={m.movement_type === "in" ? "success" : "neutral"}
                        label={m.movement_type === "in" ? "In" : "Out"}
                      />
                    </td>
                    <td data-numeric>{m.quantity}</td>
                    <td className="text-muted-foreground">{m.reason ?? "—"}</td>
                    <td className="text-muted-foreground">{m.actor_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Transfers to Health</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {transfers.length} transfer{transfers.length === 1 ? "" : "s"}
          </span>
        </header>
        {transfers.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No transfers to Health yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Item</th>
                  <th>Requested</th>
                  <th>Confirmed</th>
                  <th>Status</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium">{t.item_name}</td>
                    <td data-numeric>
                      {t.quantity_requested} {t.unit}
                    </td>
                    <td data-numeric>{t.quantity_confirmed !== null ? `${t.quantity_confirmed} ${t.unit}` : "—"}</td>
                    <td>
                      <StatusBadge
                        tone={t.status === "accepted" ? "success" : t.status === "rejected" ? "danger" : "neutral"}
                        label={t.status === "rejected" && t.rejection_reason ? `Rejected: ${t.rejection_reason}` : t.status}
                      />
                    </td>
                    <td className="text-muted-foreground">{new Date(t.initiated_at).toLocaleDateString()}</td>
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
