"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createAcademicYear, setActiveAcademicYear, createTerm, setActiveTerm } from "@/app/academics/actions";

export interface AcademicYearRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
}

export interface TermRow {
  id: string;
  academic_year_id: string;
  name: string;
  term_number: number;
  start_date: string;
  end_date: string;
  status: string;
}

function statusTone(status: string) {
  return status === "active" ? "success" : "neutral";
}

export function YearsTermsSection({
  years,
  terms,
  canWrite,
}: {
  years: AcademicYearRow[];
  terms: TermRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [yearDialogOpen, setYearDialogOpen] = useState(false);
  const [termDialogOpen, setTermDialogOpen] = useState<string | null>(null); // academic_year_id
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [yearForm, setYearForm] = useState({ name: "", start_date: "", end_date: "" });
  const [termForm, setTermForm] = useState({ name: "", term_number: 1, start_date: "", end_date: "" });

  async function handleCreateYear() {
    setPending(true);
    setError(null);
    const result = await createAcademicYear(yearForm);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setYearDialogOpen(false);
    setYearForm({ name: "", start_date: "", end_date: "" });
    router.refresh();
  }

  async function handleActivateYear(id: string) {
    setPending(true);
    const result = await setActiveAcademicYear(id);
    setPending(false);
    if ("error" in result) setError(result.error);
    else router.refresh();
  }

  async function handleCreateTerm(academic_year_id: string) {
    setPending(true);
    setError(null);
    const result = await createTerm({ academic_year_id, ...termForm });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setTermDialogOpen(null);
    setTermForm({ name: "", term_number: 1, start_date: "", end_date: "" });
    router.refresh();
  }

  async function handleActivateTerm(id: string, academic_year_id: string) {
    setPending(true);
    const result = await setActiveTerm(id, academic_year_id);
    setPending(false);
    if ("error" in result) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Academic years</h2>
          {canWrite && (
            <Dialog open={yearDialogOpen} onOpenChange={setYearDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  Add year
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New academic year</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      placeholder="2026"
                      value={yearForm.name}
                      onChange={(e) => setYearForm({ ...yearForm, name: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Start date</Label>
                      <Input
                        type="date"
                        value={yearForm.start_date}
                        onChange={(e) => setYearForm({ ...yearForm, start_date: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>End date</Label>
                      <Input
                        type="date"
                        value={yearForm.end_date}
                        onChange={(e) => setYearForm({ ...yearForm, end_date: e.target.value })}
                      />
                    </div>
                  </div>
                  {error && <p className="text-sm text-danger">{error}</p>}
                </div>
                <DialogFooter>
                  <Button onClick={handleCreateYear} disabled={pending}>
                    {pending ? "Creating…" : "Create year"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {years.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No academic years yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {years.map((y) => (
                <TableRow key={y.id}>
                  <TableCell className="font-medium">{y.name}</TableCell>
                  <TableCell>{y.start_date}</TableCell>
                  <TableCell>{y.end_date}</TableCell>
                  <TableCell>
                    <StatusBadge tone={statusTone(y.status)} label={y.status} />
                  </TableCell>
                  <TableCell>
                    {canWrite && y.status !== "active" && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleActivateYear(y.id)}>
                        Set active
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Terms</h2>
        {years.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add an academic year first.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {years.map((y) => {
              const yearTerms = terms.filter((t) => t.academic_year_id === y.id);
              return (
                <div key={y.id} className="rounded-md border border-border p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">{y.name}</p>
                    {canWrite && (
                      <Dialog
                        open={termDialogOpen === y.id}
                        onOpenChange={(open) => setTermDialogOpen(open ? y.id : null)}
                      >
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline">
                            Add term
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>New term — {y.name}</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label>Name</Label>
                                <Input
                                  placeholder="Term 1"
                                  value={termForm.name}
                                  onChange={(e) => setTermForm({ ...termForm, name: e.target.value })}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Term number (1–3)</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={3}
                                  value={termForm.term_number}
                                  onChange={(e) =>
                                    setTermForm({ ...termForm, term_number: Number(e.target.value) })
                                  }
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label>Start date</Label>
                                <Input
                                  type="date"
                                  value={termForm.start_date}
                                  onChange={(e) => setTermForm({ ...termForm, start_date: e.target.value })}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>End date</Label>
                                <Input
                                  type="date"
                                  value={termForm.end_date}
                                  onChange={(e) => setTermForm({ ...termForm, end_date: e.target.value })}
                                />
                              </div>
                            </div>
                            {error && <p className="text-sm text-danger">{error}</p>}
                          </div>
                          <DialogFooter>
                            <Button onClick={() => handleCreateTerm(y.id)} disabled={pending}>
                              {pending ? "Creating…" : "Create term"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                  {yearTerms.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No terms yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {yearTerms.map((t) => (
                        <li key={t.id} className="flex items-center justify-between text-sm">
                          <span>
                            {t.name} · {t.start_date} – {t.end_date}
                          </span>
                          <span className="flex items-center gap-2">
                            <StatusBadge tone={statusTone(t.status)} label={t.status} />
                            {canWrite && t.status !== "active" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={pending}
                                onClick={() => handleActivateTerm(t.id, y.id)}
                              >
                                Set active
                              </Button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
