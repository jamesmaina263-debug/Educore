"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createCbaWindow, updateCbaWindow, setCbaWindowActive, type CbaWindowInput } from "@/app/(admin)/admin/cba-windows/actions";

export interface CbaWindowRow {
  id: string;
  title: string;
  grade_labels: string[] | null;
  opens_at: string | null;
  closes_at: string;
  notes: string | null;
  source_url: string | null;
  is_active: boolean;
  created_at: string;
}

const emptyForm: CbaWindowInput = {
  title: "",
  gradeLabels: [],
  opensAt: null,
  closesAt: "",
  notes: null,
  sourceUrl: null,
};

function toGradeLabelsInput(labels: string[] | null): string {
  return (labels ?? []).join(", ");
}

function fromGradeLabelsInput(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AdminCbaWindowsTable({ rows }: { rows: CbaWindowRow[] }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CbaWindowInput>(emptyForm);
  const [gradeLabelsText, setGradeLabelsText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const activeRows = useMemo(() => rows.filter((r) => r.is_active), [rows]);
  const inactiveRows = useMemo(() => rows.filter((r) => !r.is_active), [rows]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setGradeLabelsText("");
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(row: CbaWindowRow) {
    setEditingId(row.id);
    setForm({
      title: row.title,
      gradeLabels: row.grade_labels ?? [],
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      notes: row.notes,
      sourceUrl: row.source_url,
    });
    setGradeLabelsText(toGradeLabelsInput(row.grade_labels));
    setError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) return setError("Title is required.");
    if (!form.closesAt) return setError("Closing date is required.");

    setPending(true);
    setError(null);
    const payload: CbaWindowInput = { ...form, gradeLabels: fromGradeLabelsInput(gradeLabelsText) };
    const result = editingId ? await updateCbaWindow(editingId, payload) : await createCbaWindow(payload);
    setPending(false);
    if ("error" in result) return setError(result.error);

    setDialogOpen(false);
    router.refresh();
  }

  async function handleToggleActive(row: CbaWindowRow) {
    setTogglingId(row.id);
    await setCbaWindowActive(row.id, !row.is_active);
    setTogglingId(null);
    router.refresh();
  }

  function renderRow(row: CbaWindowRow) {
    return (
      <tr key={row.id}>
        <td>{row.title}</td>
        <td>{row.grade_labels && row.grade_labels.length > 0 ? row.grade_labels.join(", ") : "All grades"}</td>
        <td>{row.opens_at ? new Date(row.opens_at).toLocaleDateString() : "—"}</td>
        <td>{new Date(row.closes_at).toLocaleDateString()}</td>
        <td>
          {row.source_url ? (
            <a href={row.source_url} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
              Source
            </a>
          ) : (
            "—"
          )}
        </td>
        <td>
          <StatusBadge tone={row.is_active ? "success" : "neutral"} label={row.is_active ? "Active" : "Inactive"} />
        </td>
        <td>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleToggleActive(row)}
              disabled={togglingId === row.id}
            >
              {togglingId === row.id ? "Updating…" : row.is_active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">Windows</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate}>
              Add window
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit assessment window" : "Add assessment window"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cba_title">Title</Label>
                <Input
                  id="cba_title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Grade 4/5 Term 3 CBA Upload"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cba_grades">Applies to grades (comma-separated, blank = all grades)</Label>
                <Input
                  id="cba_grades"
                  value={gradeLabelsText}
                  onChange={(e) => setGradeLabelsText(e.target.value)}
                  placeholder="Grade 4, Grade 5"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cba_opens">Opens (optional)</Label>
                  <Input
                    id="cba_opens"
                    type="date"
                    value={form.opensAt ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, opensAt: e.target.value || null }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cba_closes">Closes</Label>
                  <Input
                    id="cba_closes"
                    type="date"
                    value={form.closesAt}
                    onChange={(e) => setForm((f) => ({ ...f, closesAt: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cba_source">Source URL (KNEC circular/notice)</Label>
                <Input
                  id="cba_source"
                  value={form.sourceUrl ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value || null }))}
                  placeholder="https://..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cba_notes">Notes (optional)</Label>
                <Textarea
                  id="cba_notes"
                  value={form.notes ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))}
                  rows={2}
                />
              </div>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <DialogFooter>
              <Button onClick={handleSave} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead className="bg-muted/70">
            <tr>
              <th>Title</th>
              <th>Grades</th>
              <th>Opens</th>
              <th>Closes</th>
              <th>Source</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {activeRows.length === 0 && inactiveRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                  No assessment windows yet — add the first one above.
                </td>
              </tr>
            ) : (
              <>
                {activeRows.map(renderRow)}
                {inactiveRows.map(renderRow)}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
