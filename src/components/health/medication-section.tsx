"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { administerMedication } from "@/app/(app)/health/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { StudentCombobox } from "@/components/shared/student-combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useServerTableParams } from "@/hooks/use-server-table-params";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { queueMutation } from "@/lib/offline/queue";
import { HealthOfflineBanner } from "./offline-banner";
import type { StudentOption } from "./student-picker";

export interface MedicationRow {
  id: string;
  student_name: string;
  medication_name: string;
  dosage: string;
  route: string;
  quantity_administered: number | null;
  administered_at: string;
  administered_by_name: string | null;
}

export interface MedicalInventoryOption {
  id: string;
  name: string;
  quantity: number;
  unit: string;
}

// Values must match medication_administrations_route_check in the DB exactly
// (lowercase) -- labels are what the nurse sees.
const ROUTES = [
  { value: "oral", label: "Oral" },
  { value: "topical", label: "Topical" },
  { value: "inhaled", label: "Inhaled" },
  { value: "injection", label: "Injection" },
  { value: "other", label: "Other" },
];

function routeLabel(value: string): string {
  return ROUTES.find((r) => r.value === value)?.label ?? value;
}

/**
 * `administrations` arrives already paginated/searched server-side (see
 * getMedicationPage) -- same useServerTableParams pattern as
 * boarding/transfers-section.tsx (#346). Doesn't touch loadHealthContext.
 */
function MedicationSectionInner({
  administrations,
  totalCount,
  pageSize,
  studentOptions,
  inventoryOptions,
  canWrite,
}: {
  administrations: MedicationRow[];
  totalCount: number;
  pageSize: number;
  studentOptions: StudentOption[];
  inventoryOptions: MedicalInventoryOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { pageIndex, pageCount, onPageChange, search, onSearchChange } = useServerTableParams({
    totalCount,
    pageSize,
  });
  const page = pageIndex + 1;
  const { online, pendingCount, failed, syncing, sync, discard } = useOfflineSync("health");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    student_id: "",
    medication_name: "",
    dosage: "",
    route: ROUTES[0].value,
    inventory_item_id: "none",
    quantity: "1",
    notes: "",
  });

  const selectedInventoryItem = inventoryOptions.find((i) => i.id === form.inventory_item_id);

  async function submit() {
    if (!form.student_id || !form.medication_name || !form.dosage) {
      setError("Student, medication, and dosage are required.");
      return;
    }
    const parsedQuantity = Number(form.quantity);
    if (form.inventory_item_id !== "none") {
      if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
        setError("Enter a valid quantity to deduct from stock.");
        return;
      }
      if (selectedInventoryItem && parsedQuantity > selectedInventoryItem.quantity) {
        setError(`Only ${selectedInventoryItem.quantity} ${selectedInventoryItem.unit} in stock.`);
        return;
      }
    }
    setPending(true);
    setError(null);
    // OS-08: generated once here so a queued-then-replayed retry (lost ack after the
    // original request actually landed) reuses the same key instead of double-deducting
    // stock or recording a second dose that was never actually given.
    const clientMutationId = crypto.randomUUID();
    const input = {
      student_id: form.student_id,
      medication_name: form.medication_name,
      dosage: form.dosage,
      route: form.route,
      inventory_item_id: form.inventory_item_id === "none" ? undefined : form.inventory_item_id,
      quantity: form.inventory_item_id === "none" ? undefined : parsedQuantity,
      notes: form.notes || undefined,
      client_mutation_id: clientMutationId,
    };
    if (!online) {
      // Inventory deduction (if any) only happens when this replays on
      // reconnect -- the stock count shown right now won't reflect this
      // dose until then, same as any other offline-queued write.
      await queueMutation("health", "administerMedication", input);
      setPending(false);
      setOpen(false);
      setForm({ student_id: "", medication_name: "", dosage: "", route: ROUTES[0].value, inventory_item_id: "none", quantity: "1", notes: "" });
      return;
    }
    const result = await administerMedication(input);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setForm({ student_id: "", medication_name: "", dosage: "", route: ROUTES[0].value, inventory_item_id: "none", quantity: "1", notes: "" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <HealthOfflineBanner online={online} pendingCount={pendingCount} failed={failed} syncing={syncing} sync={sync} discard={discard} />
      <div className="flex flex-wrap items-center justify-between gap-3">
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
              <StudentCombobox
                students={studentOptions}
                value={form.student_id}
                onChange={(v) => setForm({ ...form, student_id: v })}
                placeholder="Student"
              />
              <Select
                value={form.inventory_item_id}
                onValueChange={(v) => {
                  const picked = inventoryOptions.find((i) => i.id === v);
                  setForm({
                    ...form,
                    inventory_item_id: v,
                    // Auto-fill (and lock) the name from the stock item so what's recorded can
                    // never drift from what's actually deducted. Switching back to "not tracked"
                    // clears it so a real non-stock medication can be typed in.
                    medication_name: picked ? picked.name : "",
                    quantity: "1",
                  });
                }}
              >
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  placeholder="Medication name"
                  value={form.medication_name}
                  disabled={form.inventory_item_id !== "none"}
                  onChange={(e) => setForm({ ...form, medication_name: e.target.value })}
                />
                <Input placeholder="Dosage (e.g. 5ml)" value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} />
              </div>
              {form.inventory_item_id !== "none" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    type="number"
                    min={1}
                    max={selectedInventoryItem?.quantity}
                    step={1}
                    placeholder="Quantity administered"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                  <p className="flex items-center text-xs text-muted-foreground">
                    {selectedInventoryItem
                      ? `${selectedInventoryItem.unit} — deducted from stock on Record`
                      : ""}
                  </p>
                </div>
              )}
              {form.inventory_item_id !== "none" && (
                <p className="-mt-2 text-xs text-muted-foreground">Name is set from the selected stock item.</p>
              )}
              {form.inventory_item_id === "none" &&
                form.medication_name.trim().length > 0 &&
                inventoryOptions.some((i) => i.name.toLowerCase() === form.medication_name.trim().toLowerCase()) && (
                  <p className="-mt-2 text-xs text-amber-600">
                    &ldquo;{form.medication_name.trim()}&rdquo; is in your medical stock — select it above so this dose gets deducted from
                    inventory, or leave as-is only if this dose truly isn&rsquo;t from stock (e.g. a parent-supplied medication).
                  </p>
                )}
              <Select value={form.route} onValueChange={(v) => setForm({ ...form, route: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
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
        <Input
          placeholder="Search by student name or admission number…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="max-w-xs"
        />
      </div>

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
                <td>
                  {m.dosage}
                  {m.quantity_administered != null && (
                    <span className="ml-1 text-xs text-muted-foreground">({m.quantity_administered} deducted)</span>
                  )}
                </td>
                <td>{routeLabel(m.route)}</td>
                <td>{new Date(m.administered_at).toLocaleString()}</td>
                <td className="text-muted-foreground">{m.administered_by_name ?? "—"}</td>
              </tr>
            ))}
            {administrations.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  {search ? "No administrations match this search." : "No medication administered yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {totalCount === 0
            ? ""
            : `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, totalCount)} of ${totalCount}`}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(pageIndex - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {pageCount}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pageCount}
              onClick={() => onPageChange(pageIndex + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MedicationSection(props: {
  administrations: MedicationRow[];
  totalCount: number;
  pageSize: number;
  studentOptions: StudentOption[];
  inventoryOptions: MedicalInventoryOption[];
  canWrite: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <MedicationSectionInner {...props} />
    </Suspense>
  );
}
