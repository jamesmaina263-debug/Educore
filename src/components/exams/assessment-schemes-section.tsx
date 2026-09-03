"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { createAssessmentScheme } from "@/app/(app)/exams/actions";
import type { AssessmentSchemeRow } from "@/app/(app)/exams/_data";

type ComponentDraft = { name: string; weight_percent: string };

const emptyComponent: ComponentDraft = { name: "", weight_percent: "" };

export function AssessmentSchemesSection({ schemes, canWrite }: { schemes: AssessmentSchemeRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [components, setComponents] = useState<ComponentDraft[]>([{ ...emptyComponent }, { ...emptyComponent }]);

  function updateComponent(index: number, patch: Partial<ComponentDraft>) {
    setComponents((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  const totalWeight = components.reduce((sum, c) => sum + (Number(c.weight_percent) || 0), 0);

  async function handleCreate() {
    setPending(true);
    setError(null);
    const result = await createAssessmentScheme({
      name,
      is_default: isDefault,
      components: components
        .filter((c) => c.name.trim() !== "")
        .map((c) => ({ name: c.name, weight_percent: Number(c.weight_percent) || 0 })),
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setName("");
    setIsDefault(false);
    setComponents([{ ...emptyComponent }, { ...emptyComponent }]);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="label-eyebrow">Assessment weighting</p>
          <p className="text-sm text-muted-foreground">
            How your school combines exams into a term score (e.g. Continuous Assessment 60% + Summative Exam 40%) —
            your own configuration, not a KNEC requirement. Assign an exam to a component from the exam&apos;s edit
            screen.
          </p>
        </div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                New scheme
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>New assessment scheme</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input placeholder="Term Composite" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="scheme_is_default" checked={isDefault} onCheckedChange={(c) => setIsDefault(c === true)} />
                  <Label htmlFor="scheme_is_default">Use as this school&apos;s default scheme</Label>
                </div>
                <div className="space-y-2">
                  <Label>Components (must add up to 100%)</Label>
                  {components.map((c, i) => (
                    <div key={i} className="grid grid-cols-[2fr_1fr] gap-2">
                      <Input
                        placeholder="Continuous Assessment"
                        value={c.name}
                        onChange={(e) => updateComponent(i, { name: e.target.value })}
                      />
                      <Input
                        placeholder="Weight %"
                        type="number"
                        value={c.weight_percent}
                        onChange={(e) => updateComponent(i, { weight_percent: e.target.value })}
                      />
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setComponents((p) => [...p, { ...emptyComponent }])}>
                    + Add component
                  </Button>
                  <p className={`text-xs ${totalWeight === 100 ? "text-muted-foreground" : "text-danger"}`}>
                    Total: {totalWeight}%
                  </p>
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button onClick={handleCreate} disabled={pending || !name.trim() || totalWeight !== 100}>
                  {pending ? "Creating…" : "Create scheme"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {schemes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assessment schemes configured yet — exams count individually.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scheme</TableHead>
              <TableHead>Components</TableHead>
              <TableHead>Default</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schemes.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {s.components.map((c) => `${c.name} (${c.weight_percent}%)`).join(", ")}
                </TableCell>
                <TableCell>{s.is_default && <StatusBadge tone="success" label="Default" />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
