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
import { createTemplateAction } from "@/app/communication/actions";

export interface TemplateRow {
  id: string;
  name: string;
  category: string;
  body: string;
  channel: "sms" | "email" | "whatsapp";
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
] as const;

export function TemplatesSection({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("fee_reminder");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]["value"]>("sms");
  const [body, setBody] = useState("");

  async function handleCreate() {
    setPending(true);
    setError(null);
    const result = await createTemplateAction({ name, category, body, channel });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setName("");
    setBody("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Templates</h2>
          <div className="flex items-center gap-3">
            <span className="text-[0.6875rem] text-muted-foreground">
              {templates.length} template{templates.length === 1 ? "" : "s"}
            </span>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  New template
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New template</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Fee reminder" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
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
                    <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
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
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={3}
                      placeholder="Dear parent, {{student_name}} has an outstanding balance of KES {{balance}} at {{school_name}}."
                    />
                  </div>
                  {error && <p className="text-sm text-danger">{error}</p>}
                </div>
                <DialogFooter>
                  <Button onClick={handleCreate} disabled={pending || !name.trim() || !body.trim()}>
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
              <li key={t.id} className="p-4">
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-[0.8125rem] font-medium">{t.name}</p>
                  <StatusBadge tone="neutral" label={CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category} />
                  <StatusBadge tone="info" label={CHANNELS.find((c) => c.value === t.channel)?.label ?? t.channel} />
                </div>
                <p className="text-[0.8125rem] text-muted-foreground">{t.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
