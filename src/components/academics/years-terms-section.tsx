"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createAcademicYear, setActiveAcademicYear, updateAcademicYear, deleteAcademicYear, createTerm, setActiveTerm, updateTerm, deleteTerm } from "@/app/(app)/academics/actions";
import { prepareTermNewsletterDraftAction } from "@/app/(app)/academics/newsletter-actions";

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
  canSendNewsletter,
}: {
  years: AcademicYearRow[];
  terms: TermRow[];
  canWrite: boolean;
  canSendNewsletter: boolean;
}) {
  const router = useRouter();
  const [yearDialogOpen, setYearDialogOpen] = useState(false);
  const [termDialogOpen, setTermDialogOpen] = useState<string | null>(null); // academic_year_id
  const [editYearOpen, setEditYearOpen] = useState<AcademicYearRow | null>(null);
  const [editTermOpen, setEditTermOpen] = useState<TermRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [newsletterBusyId, setNewsletterBusyId] = useState<string | null>(null);
  const [newsletterNotice, setNewsletterNotice] = useState<string | null>(null);

  const [yearForm, setYearForm] = useState({ name: "", start_date: "", end_date: "" });
  const [termForm, setTermForm] = useState({ name: "", term_number: 1, start_date: "", end_date: "" });
  const [editYearForm, setEditYearForm] = useState({ name: "", start_date: "", end_date: "" });
  const [editTermForm, setEditTermForm] = useState({ name: "", term_number: 1, start_date: "", end_date: "" });

  function openEditYear(y: AcademicYearRow) {
    setEditYearForm({ name: y.name, start_date: y.start_date, end_date: y.end_date });
    setEditYearOpen(y);
    setError(null);
  }

  async function handleUpdateYear() {
    if (!editYearOpen) return;
    setPending(true);
    setError(null);
    const result = await updateAcademicYear(editYearOpen.id, editYearForm);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setEditYearOpen(null);
    router.refresh();
  }

  async function handleDeleteYear(id: string) {
    if (!confirm("Delete this academic year? This only works if nothing (terms, classes, records) is linked to it yet.")) return;
    setPending(true);
    setError(null);
    const result = await deleteAcademicYear(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  function openEditTerm(t: TermRow) {
    setEditTermForm({ name: t.name, term_number: t.term_number, start_date: t.start_date, end_date: t.end_date });
    setEditTermOpen(t);
    setError(null);
  }

  async function handleUpdateTerm() {
    if (!editTermOpen) return;
    setPending(true);
    setError(null);
    const result = await updateTerm(editTermOpen.id, editTermForm);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setEditTermOpen(null);
    router.refresh();
  }

  async function handleDeleteTerm(id: string) {
    if (!confirm("Delete this term? This only works if nothing (invoices, exams, records) is linked to it yet.")) return;
    setPending(true);
    setError(null);
    const result = await deleteTerm(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handlePrepareNewsletter(termId: string) {
    setNewsletterBusyId(termId);
    setNewsletterNotice(null);
    const result = await prepareTermNewsletterDraftAction(termId);
    setNewsletterBusyId(null);
    if ("error" in result) { setNewsletterNotice(result.error); return; }
    setNewsletterNotice(
      result.draftId
        ? "Draft ready for review in Academics \u2192 Newsletters."
        : "Already sent for this term \u2014 nothing new to prepare.",
    );
    router.refresh();
  }

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

  const addYearDialog = canWrite && (
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
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        {years.length === 0 ? (
          <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
            <p>No academic years yet.</p>
            {canWrite && <div className="mt-3 flex justify-center">{addYearDialog}</div>}
          </div>
        ) : (
          <div className="panel">
            <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h2 className="text-[0.8125rem] font-semibold">Academic years</h2>
              <div className="flex items-center gap-3">
                <span className="text-[0.6875rem] text-muted-foreground">
                  {years.length} year{years.length === 1 ? "" : "s"}
                </span>
                {addYearDialog}
              </div>
            </header>
            <div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead className="bg-muted/70">
                  <tr>
                    <th>Name</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => (
                    <tr key={y.id}>
                      <td className="font-medium">{y.name}</td>
                      <td className="text-muted-foreground">{y.start_date}</td>
                      <td className="text-muted-foreground">{y.end_date}</td>
                      <td>
                        <StatusBadge tone={statusTone(y.status)} label={y.status} />
                      </td>
                      <td className="text-right">
                        {canWrite && (
                          <>
                            <Button size="sm" variant="ghost" disabled={pending} onClick={() => openEditYear(y)}>
                              Edit
                            </Button>
                            {y.status !== "active" && (
                              <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleActivateYear(y.id)}>
                                Set active
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleDeleteYear(y.id)}>
                              Delete
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
                <div key={y.id} className="panel p-4">
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
                                <Label>Term number</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={12}
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
                            {canWrite && (
                              <Button size="sm" variant="ghost" disabled={pending} onClick={() => openEditTerm(t)}>
                                Edit
                              </Button>
                            )}
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
                            {canWrite && (
                              <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleDeleteTerm(t.id)}>
                                Delete
                              </Button>
                            )}
                            {canSendNewsletter && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={newsletterBusyId === t.id}
                                onClick={() => handlePrepareNewsletter(t.id)}
                                title="Prepares a draft newsletter for review in Academics → Newsletters — nothing is sent from here. A daily job also prepares one automatically once the term's end date passes. Safe to click more than once: it only ever prepares one draft per term, and never re-prepares after it's been sent."
                              >
                                {newsletterBusyId === t.id ? "Preparing…" : "Prepare newsletter"}
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
        {newsletterNotice && (
          <p className="mt-2 text-sm text-muted-foreground">
            {newsletterNotice}{" "}
            {canSendNewsletter && (
              <a href="/academics/newsletters" className="underline">
                Review newsletters
              </a>
            )}
          </p>
        )}
      </div>

      <Dialog open={editYearOpen !== null} onOpenChange={(open) => !open && setEditYearOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editYearOpen?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={editYearForm.name} onChange={(e) => setEditYearForm({ ...editYearForm, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={editYearForm.start_date}
                  onChange={(e) => setEditYearForm({ ...editYearForm, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input
                  type="date"
                  value={editYearForm.end_date}
                  onChange={(e) => setEditYearForm({ ...editYearForm, end_date: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Editing dates never moves historical attendance, marks, fees, or reports — those stay linked to this
              year by record, not by date range.
            </p>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <DialogFooter>
            <Button onClick={handleUpdateYear} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editTermOpen !== null} onOpenChange={(open) => !open && setEditTermOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editTermOpen?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={editTermForm.name} onChange={(e) => setEditTermForm({ ...editTermForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Term number</Label>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={editTermForm.term_number}
                  onChange={(e) => setEditTermForm({ ...editTermForm, term_number: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={editTermForm.start_date}
                  onChange={(e) => setEditTermForm({ ...editTermForm, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input
                  type="date"
                  value={editTermForm.end_date}
                  onChange={(e) => setEditTermForm({ ...editTermForm, end_date: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Editing dates never moves historical attendance, marks, fees, or reports — those stay linked to this
              term by record, not by date range.
            </p>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <DialogFooter>
            <Button onClick={handleUpdateTerm} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
