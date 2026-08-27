"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createFeeStructure, generateInvoicesAction, setFeeStructureActiveAction, updateFeeStructureItemsAction } from "@/app/(app)/finance/actions";

export interface FeeStructureRow {
  id: string;
  name: string;
  term_id: string;
  term_name: string;
  class_id: string | null;
  class_name: string | null;
  boarding_type: "day" | "boarder";
  fee_category: "core" | "transport";
  is_active: boolean;
  total: number;
  items: { name: string; amount: number }[];
}

type ItemDraft = { name: string; amount: string };

export function FeeStructuresSection({
  structures,
  academicYearId,
  terms,
  classes,
  canWrite,
}: {
  structures: FeeStructureRow[];
  academicYearId: string;
  terms: { id: string; name: string }[];
  classes: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<{ structureId: string; count: number } | null>(null);
  const [name, setName] = useState("");
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [classId, setClassId] = useState<string>("__all__");
  const [boardingType, setBoardingType] = useState<"day" | "boarder">("day");
  const [feeCategory, setFeeCategory] = useState<"core" | "transport">("core");
  const [items, setItems] = useState<ItemDraft[]>([{ name: "Tuition", amount: "" }]);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editStructure, setEditStructure] = useState<FeeStructureRow | null>(null);
  const [editItems, setEditItems] = useState<ItemDraft[]>([]);
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function openEdit(s: FeeStructureRow) {
    setEditStructure(s);
    setEditItems(s.items.map((i) => ({ name: i.name, amount: String(i.amount) })));
    setEditError(null);
  }

  async function handleToggleActive(s: FeeStructureRow) {
    setTogglingId(s.id);
    setError(null);
    const result = await setFeeStructureActiveAction(s.id, !s.is_active);
    setTogglingId(null);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleSaveEdit() {
    if (!editStructure) return;
    setEditPending(true);
    setEditError(null);
    const result = await updateFeeStructureItemsAction(
      editStructure.id,
      editItems.filter((i) => i.name.trim() && i.amount).map((i) => ({ name: i.name, amount: Number(i.amount) })),
    );
    setEditPending(false);
    if ("error" in result) return setEditError(result.error);
    setEditStructure(null);
    router.refresh();
  }

  async function handleCreate() {
    setPending(true);
    setError(null);
    const result = await createFeeStructure({
      academic_year_id: academicYearId,
      term_id: termId,
      class_id: classId === "__all__" ? null : classId,
      boarding_type: boardingType,
      fee_category: feeCategory,
      name,
      items: items.filter((i) => i.name.trim() && i.amount).map((i) => ({ name: i.name, amount: Number(i.amount) })),
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setName("");
    setItems([{ name: "Tuition", amount: "" }]);
    router.refresh();
  }

  async function handleGenerate(structureId: string, termIdToUse: string, classIdToUse: string | null) {
    setPending(true);
    setError(null);
    setLastGenerated(null);
    const result = await generateInvoicesAction(termIdToUse, classIdToUse);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setLastGenerated({ structureId, count: result.count });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{structures.length} fee structures configured</p>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                New fee structure
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>New fee structure</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input placeholder="Grade 4 Term 2 Fees" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Term</Label>
                    <Select value={termId} onValueChange={setTermId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {terms.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Grade</Label>
                    <Select value={classId} onValueChange={setClassId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All grades</SelectItem>
                        {classes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <Select value={feeCategory} onValueChange={(v) => setFeeCategory(v as "core" | "transport")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="core">Core (tuition/boarding)</SelectItem>
                        <SelectItem value="transport">Transport add-on</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {feeCategory === "core" && (
                  <div className="space-y-1.5">
                    <Label>Boarding</Label>
                    <Select value={boardingType} onValueChange={(v) => setBoardingType(v as "day" | "boarder")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">Day scholar</SelectItem>
                        <SelectItem value="boarder">Boarder</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {feeCategory === "transport" && (
                  <p className="text-xs text-muted-foreground">
                    Transport structures merge their items into a boarding/day student&apos;s single termly invoice
                    automatically, only for students with an active Transport assignment. No separate invoice is created.
                  </p>
                )}

                <div className="space-y-2">
                  <Label>Fee items</Label>
                  {items.map((it, i) => (
                    <div key={i} className="grid grid-cols-[2fr_1fr] gap-2">
                      <Input
                        placeholder="Tuition"
                        value={it.name}
                        onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      />
                      <Input
                        placeholder="Amount"
                        type="number"
                        value={it.amount}
                        onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                      />
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setItems((p) => [...p, { name: "", amount: "" }])}>
                    + Add item
                  </Button>
                </div>

                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button onClick={handleCreate} disabled={pending || !name.trim() || !termId}>
                  {pending ? "Creating…" : "Create structure"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {structures.length === 0 ? (
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          No fee structure set for this term yet. Invoices can&apos;t be generated until one exists.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {structures.map((s) => (
            <div key={s.id} className="panel p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{s.name}</p>
                  <Badge variant="secondary">{s.term_name}</Badge>
                  <Badge variant="outline">{s.class_name ?? "All grades"}</Badge>
                  {s.fee_category === "core" ? (
                    <StatusBadge tone={s.boarding_type === "boarder" ? "info" : "neutral"} label={s.boarding_type} />
                  ) : (
                    <StatusBadge tone="warning" label="transport add-on" />
                  )}
                  <StatusBadge tone={s.is_active ? "success" : "neutral"} label={s.is_active ? "active" : "inactive"} />
                </div>
                <p className="text-sm font-medium">KES {s.total.toLocaleString()}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                {s.items.map((it) => (
                  <span key={it.name}>
                    {it.name}: {it.amount.toLocaleString()}
                  </span>
                ))}
              </div>
              {!s.is_active && (
                <p className="mt-2 text-xs text-warning">
                  Inactive — invoice generation skips this structure entirely until it&apos;s activated.
                </p>
              )}
              {canWrite && (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => handleGenerate(s.id, s.term_id, s.class_id)}>
                      Generate invoices for {s.class_name ?? "all grades"} — {s.term_name}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                      Edit amounts
                    </Button>
                    <Button
                      size="sm"
                      variant={s.is_active ? "outline" : "default"}
                      disabled={togglingId === s.id}
                      onClick={() => handleToggleActive(s)}
                    >
                      {togglingId === s.id ? "Updating…" : s.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                  {lastGenerated?.structureId === s.id && (
                    lastGenerated.count > 0 ? (
                      <p className="mt-2 text-sm text-success">
                        {lastGenerated.count} invoice{lastGenerated.count === 1 ? "" : "s"} generated.
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No invoices generated — no active student in {s.class_name ?? "any grade"} ({s.boarding_type}) is missing an invoice for {s.term_name}. Check that the student is enrolled, active, and their class/boarding status matches this fee structure.
                      </p>
                    )
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={editStructure !== null} onOpenChange={(v) => !v && setEditStructure(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit amounts — {editStructure?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Fee items</Label>
              {editItems.map((it, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr] gap-2">
                  <Input
                    placeholder="Tuition"
                    value={it.name}
                    onChange={(e) => setEditItems((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <Input
                    placeholder="Amount"
                    type="number"
                    value={it.amount}
                    onChange={(e) => setEditItems((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                  />
                </div>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditItems((p) => [...p, { name: "", amount: "" }])}>
                + Add item
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Changes only affect invoices generated after saving — existing invoices already snapshot the amounts
              they were created with and don&apos;t recompute retroactively.
            </p>
            {editError && <p className="text-sm text-danger">{editError}</p>}
          </div>
          <DialogFooter>
            <Button onClick={handleSaveEdit} disabled={editPending}>
              {editPending ? "Saving…" : "Save amounts"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
