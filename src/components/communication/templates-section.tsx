"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createTemplateAction, updateTemplateAction } from "@/app/(app)/communication/actions";

export interface TemplateRow {
  id: string;
  name: string;
  category: string;
  body: string;
  channel: "sms" | "email" | "whatsapp" | "in_app";
}

const CATEGORIES = [
  { value: "fee_reminder", label: "Fee reminder" },
  { value: "absence_alert", label: "Absence alert" },
  { value: "result_published", label: "Result published" },
  { value: "announcement", label: "Announcement" },
  { value: "other", label: "Other" },
] as const;

const CHANNELS = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "in_app", label: "In-app" },
] as const;

type FormState = {
  name: string;
  category: (typeof CATEGORIES)[number]["value"];
  channel: (typeof CHANNELS)[number]["value"];
  body: string;
};

const EMPTY_FORM: FormState = { name: "", category: "fee_reminder", channel: "sms", body: "" };

function TemplateForm({
  value,
  onChange,
  error,
}: {
  value: FormState;
  onChange: (v: FormState) => void;
  error: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="Fee reminder" />
      </div>
      <div className="space-y-1.5">
        <Label>Category</Label>
        <Select value={value.category} onValueChange={(v) => onChange({ ...value, category: v as FormState["category"] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Channel</Label>
        <Select value={value.channel} onValueChange={(v) => onChange({ ...value, channel: v as FormState["channel"] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANNELS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Body</Label>
        <Textarea
          value={value.body}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          rows={3}
          placeholder="Dear parent, {{student_name}} has an outstanding balance of KES {{balance}} at {{school_name}}."
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export function TemplatesSection({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(EMPTY_FORM);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  async function handleCreate() {
    setPending(true);
    setError(null);
    const result = await createTemplateAction(createForm);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setCreateOpen(false);
    setCreateForm(EMPTY_FORM);
    router.refresh();
  }

  function openEdit(t: TemplateRow) {
    setEditingId(t.id);
    setEditForm({ name: t.name, category: t.category as FormState["category"], channel: t.channel, body: t.body });
    setError(null);
  }

  async function handleUpdate() {
    if (!editingId) return;
    setPending(true);
    setError(null);
    const result = await updateTemplateAction(editingId, editForm);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setEditingId(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && !editingId && !createOpen && <p className="text-sm text-danger">{error}</p>}

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Templates</h2>
          <div className="flex items-center gap-3">
            <span className="text-[0.6875rem] text-muted-foreground">
              {templates.length} template{templates.length === 1 ? "" : "s"}
            </span>
            <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (o) { setCreateForm(EMPTY_FORM); setError(null); } }}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  New template
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New template</DialogTitle>
                </DialogHeader>
                <TemplateForm value={createForm} onChange={setCreateForm} error={createOpen ? error : null} />
                <DialogFooter>
                  <Button onClick={handleCreate} disabled={pending || !createForm.name.trim() || !createForm.body.trim()}>
                    {pending ? "Saving…" : "Save template"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {templates.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No templates yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {templates.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-4 p-4">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <p className="text-[0.8125rem] font-medium">{t.name}</p>
                    <StatusBadge tone="neutral" label={CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category} />
                    <StatusBadge tone="info" label={CHANNELS.find((c) => c.value === t.channel)?.label ?? t.channel} />
                  </div>
                  <p className="text-[0.8125rem] text-muted-foreground">{t.body}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => openEdit(t)}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={editingId !== null} onOpenChange={(o) => !o && setEditingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit template</DialogTitle>
          </DialogHeader>
          <TemplateForm value={editForm} onChange={setEditForm} error={editingId ? error : null} />
          <DialogFooter>
            <Button onClick={handleUpdate} disabled={pending || !editForm.name.trim() || !editForm.body.trim()}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
