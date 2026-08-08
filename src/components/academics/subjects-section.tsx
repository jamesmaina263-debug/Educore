"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createSubject } from "@/app/academics/actions";

export interface SubjectRow {
  id: string;
  name: string;
  code: string | null;
  is_core: boolean;
}

export function SubjectsSection({ subjects, canWrite }: { subjects: SubjectRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", is_core: true });

  async function handleCreate() {
    setPending(true);
    setError(null);
    const result = await createSubject(form);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setForm({ name: "", code: "", is_core: true });
    router.refresh();
  }

  return (
    <div className="panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">Subjects</h2>
        <div className="flex items-center gap-3">
          <span className="text-[0.6875rem] text-muted-foreground">
            {subjects.length} subject{subjects.length === 1 ? "" : "s"}
          </span>
          {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  Add subject
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New subject</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Name</Label>
                      <Input
                        placeholder="Mathematics"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Code (optional)</Label>
                      <Input
                        placeholder="MATH"
                        value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="is_core"
                      checked={form.is_core}
                      onCheckedChange={(c) => setForm({ ...form, is_core: c === true })}
                    />
                    <Label htmlFor="is_core">Core subject</Label>
                  </div>
                  {error && <p className="text-sm text-danger">{error}</p>}
                </div>
                <DialogFooter>
                  <Button onClick={handleCreate} disabled={pending}>
                    {pending ? "Creating…" : "Create subject"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </header>

      {subjects.length === 0 ? (
        <p className="p-10 text-center text-sm text-muted-foreground">No subjects yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td className="text-muted-foreground">{s.code ?? "—"}</td>
                  <td>
                    <StatusBadge tone={s.is_core ? "info" : "neutral"} label={s.is_core ? "Core" : "Elective"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
