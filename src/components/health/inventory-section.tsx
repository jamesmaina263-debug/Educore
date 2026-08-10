"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addMedicalInventoryItem, adjustMedicalStock } from "@/app/health/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

export interface MedicalItemRow {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  reorder_level: number | null;
  expiry_date: string | null;
}

export function InventorySection({
  items,
  medicalCategoryId,
  canWrite,
}: {
  items: MedicalItemRow[];
  medicalCategoryId: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [form, setForm] = useState({ name: "", unit: "pieces", reorder_level: "", expiry_date: "" });

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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

  async function adjust(itemId: string, direction: "in" | "out") {
    const qty = Number(adjustQty);
    if (!qty || qty <= 0) return;
    setPending(true);
    const result = await adjustMedicalStock(itemId, direction, qty);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setAdjustingId(null);
    setAdjustQty("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Managed through the shared Inventory module, filtered to the &ldquo;Medical Supplies&rdquo; category — full stock history is on the{" "}
        <a href="/inventory" className="underline">
          Inventory
        </a>{" "}
        page.
      </p>

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
              <div className="grid grid-cols-2 gap-3">
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
                          <Button size="sm" variant="outline" onClick={() => adjust(i.id, "in")} disabled={pending}>
                            +In
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => adjust(i.id, "out")} disabled={pending}>
                            -Out
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setAdjustingId(i.id)}>
                          Adjust stock
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
