"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createInventoryItemAction, createCategoryAction, recordStockMovementAction } from "@/app/inventory/actions";

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

export function InventorySection({
  items,
  categories,
  movements,
  canWrite,
}: {
  items: ItemRow[];
  categories: CategoryOption[];
  movements: MovementRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
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
    const result = await recordStockMovementAction({
      item_id: moveItemId,
      movement_type: moveType,
      quantity: Number(moveQuantity),
      reason: moveReason,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setMoveOpen(false);
    setMoveItemId("");
    setMoveQuantity("");
    setMoveReason("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
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
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Items</h2>
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No items yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Quantity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => {
                const low = i.reorder_level !== null && i.quantity <= i.reorder_level;
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.name}</TableCell>
                    <TableCell>{i.category_name ?? "—"}</TableCell>
                    <TableCell>{i.location ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={low ? "warning" : "secondary"}>
                        {i.quantity} {i.unit}
                        {low ? " · low stock" : ""}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Recent movements</h2>
        {movements.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No movements yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.item_name}</TableCell>
                  <TableCell>
                    <Badge variant={m.movement_type === "in" ? "success" : "secondary"}>{m.movement_type === "in" ? "In" : "Out"}</Badge>
                  </TableCell>
                  <TableCell>{m.quantity}</TableCell>
                  <TableCell>{m.reason ?? "—"}</TableCell>
                  <TableCell>{m.actor_name ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
