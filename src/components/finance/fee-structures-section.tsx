"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createFeeStructure, generateInvoicesAction } from "@/app/finance/actions";

export interface FeeStructureRow {
  id: string;
  name: string;
  term_id: string;
  term_name: string;
  class_id: string | null;
  class_name: string | null;
  boarding_type: "day" | "boarder";
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
  const [name, setName] = useState("");
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [classId, setClassId] = useState<string>("__all__");
  const [boardingType, setBoardingType] = useState<"day" | "boarder">("day");
  const [items, setItems] = useState<ItemDraft[]>([{ name: "Tuition", amount: "" }]);

  async function handleCreate() {
    setPending(true);
    setError(null);
    const result = await createFeeStructure({
      academic_year_id: academicYearId,
      term_id: termId,
      class_id: classId === "__all__" ? null : classId,
      boarding_type: boardingType,
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

  async function handleGenerate(termIdToUse: string, classIdToUse: string | null) {
    setPending(true);
    setError(null);
    const result = await generateInvoicesAction(termIdToUse, classIdToUse);
    setPending(false);
    if ("error" in result) return setError(result.error);
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
                <div className="grid grid-cols-3 gap-3">
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
                </div>

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
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No fee structure set for this term yet. Invoices can&apos;t be generated until one exists.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {structures.map((s) => (
            <div key={s.id} className="rounded-md border border-border p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{s.name}</p>
                  <Badge variant="secondary">{s.term_name}</Badge>
                  <Badge variant="outline">{s.class_name ?? "All grades"}</Badge>
                  <Badge variant={s.boarding_type === "boarder" ? "info" : "outline"}>{s.boarding_type}</Badge>
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
              {canWrite && (
                <Button size="sm" variant="outline" className="mt-3" disabled={pending} onClick={() => handleGenerate(s.term_id, s.class_id)}>
                  Generate invoices for {s.class_name ?? "all grades"} — {s.term_name}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
