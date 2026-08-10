"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { administerMedication } from "@/app/health/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import type { StudentOption } from "./student-picker";

export interface MedicationRow {
  id: string;
  student_name: string;
  medication_name: string;
  dosage: string;
  route: string;
  administered_at: string;
  administered_by_name: string | null;
}

export interface MedicalInventoryOption {
  id: string;
  name: string;
  quantity: number;
}

const ROUTES = ["Oral", "Topical", "Inhaled", "Injection", "Other"];

export function MedicationSection({
  administrations,
  studentOptions,
  inventoryOptions,
  canWrite,
}: {
  administrations: MedicationRow[];
  studentOptions: StudentOption[];
  inventoryOptions: MedicalInventoryOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    student_id: "",
    medication_name: "",
    dosage: "",
    route: ROUTES[0],
    inventory_item_id: "none",
    notes: "",
  });

  async function submit() {
    if (!form.student_id || !form.medication_name || !form.dosage) {
      setError("Student, medication, and dosage are required.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await administerMedication({
      student_id: form.student_id,
      medication_name: form.medication_name,
      dosage: form.dosage,
      route: form.route,
      inventory_item_id: form.inventory_item_id === "none" ? undefined : form.inventory_item_id,
      notes: form.notes || undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setForm({ student_id: "", medication_name: "", dosage: "", route: ROUTES[0], inventory_item_id: "none", notes: "" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="self-start">
              Record medication given
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Administer medication</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Select value={form.student_id} onValueChange={(v) => setForm({ ...form, student_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Student" />
                </SelectTrigger>
                <SelectContent>
                  {studentOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Medication name" value={form.medication_name} onChange={(e) => setForm({ ...form, medication_name: e.target.value })} />
                <Input placeholder="Dosage (e.g. 5ml)" value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} />
              </div>
              <Select value={form.route} onValueChange={(v) => setForm({ ...form, route: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={form.inventory_item_id} onValueChange={(v) => setForm({ ...form, inventory_item_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Deduct from medical inventory (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not tracked in inventory</SelectItem>
                  {inventoryOptions.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name} ({i.quantity} in stock)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              {error && <p className="text-sm text-danger">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={pending}>
                {pending ? "Recording…" : "Record"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead>
            <tr>
              <th className="text-left">Student</th>
              <th className="text-left">Medication</th>
              <th className="text-left">Dosage</th>
              <th className="text-left">Route</th>
              <th className="text-left">When</th>
              <th className="text-left">Administered by</th>
            </tr>
          </thead>
          <tbody>
            {administrations.map((m) => (
              <tr key={m.id}>
                <td>{m.student_name}</td>
                <td>{m.medication_name}</td>
                <td>{m.dosage}</td>
                <td>{m.route}</td>
                <td>{new Date(m.administered_at).toLocaleString()}</td>
                <td className="text-muted-foreground">{m.administered_by_name ?? "—"}</td>
              </tr>
            ))}
            {administrations.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  No medication administered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
