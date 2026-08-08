"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{subjects.length} subjects</p>
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

      {subjects.length === 0 ? (
        <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
          No subjects yet.
        </div>
      ) : (
        <div className="panel overflow-x-auto">
        <Table className="table-dense">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subjects.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{s.code ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={s.is_core ? "secondary" : "outline"}>
                    {s.is_core ? "Core" : "Elective"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}
    </div>
  );
}
