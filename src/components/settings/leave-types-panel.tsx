"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createLeaveType, updateLeaveType, deleteLeaveType } from "@/app/(app)/settings/actions";

export interface LeaveTypeRow {
  id: string;
  name: string;
  days_per_year: number;
}

export function LeaveTypesPanel({ rows, canManage }: { rows: LeaveTypeRow[]; canManage: boolean }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ name: "", days_per_year: "" });

  function openAdd() {
    setForm({ name: "", days_per_year: "" });
    setError(null);
    setAddOpen(true);
  }

  function openEdit(row: LeaveTypeRow) {
    setForm({ name: row.name, days_per_year: String(row.days_per_year) });
    setError(null);
    setEditingId(row.id);
  }

  function parsedDays(): number | null {
    const trimmed = form.days_per_year.trim();
    if (trimmed === "") return NaN;
    const n = Number(trimmed);
    return n;
  }

  async function handleCreate() {
    const days = parsedDays();
    if (days === null || Number.isNaN(days)) {
      setError("Days per year must be a number.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await createLeaveType({ name: form.name, days_per_year: days });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setAddOpen(false);
    router.refresh();
  }

  async function handleUpdate() {
    if (!editingId) return;
    const days = parsedDays();
    if (days === null || Number.isNaN(days)) {
      setError("Days per year must be a number.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await updateLeaveType(editingId, { name: form.name, days_per_year: days });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setEditingId(null);
    router.refresh();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This only works if no leave request has ever used it — you can rename it instead.`))
      return;
    setPending(true);
    const result = await deleteLeaveType(id);
    setPending(false);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    router.refresh();
  }

  const editingRow = rows.find((r) => r.id === editingId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Leave types your staff can request against. Every school starts with a default set — edit, remove, or add
          your own at any time.
        </p>
        {canManage && (
          <Dialog open={addOpen} onOpenChange={(open) => (open ? openAdd() : setAddOpen(false))}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Add leave type
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New leave type</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    placeholder="e.g. Annual Leave"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Days per year</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="e.g. 21"
                    value={form.days_per_year}
                    onChange={(e) => setForm({ ...form, days_per_year: e.target.value })}
                  />
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button onClick={handleCreate} disabled={pending}>
                  {pending ? "Creating…" : "Create leave type"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
          No leave types configured yet. Staff won&apos;t be able to request leave until at least one exists.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{r.name}</span>{" "}
                <span className="text-muted-foreground">— {r.days_per_year} days/year</span>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => openEdit(r)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleDelete(r.id, r.name)}>
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editingRow !== null} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit leave type</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Days per year</Label>
              <Input
                type="number"
                min={0}
                value={form.days_per_year}
                onChange={(e) => setForm({ ...form, days_per_year: e.target.value })}
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <DialogFooter>
            <Button onClick={handleUpdate} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
