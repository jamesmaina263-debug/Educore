"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { saveSalesLead } from "@/app/(admin)/admin/sales-pipeline/actions";
import { SCHOOL_TYPES, SOURCES, type SalesLeadRow } from "@/lib/sales/pipeline";

export type RepOption = { id: string; name: string };

const NONE = "__none__";

type FormState = {
  school_name: string;
  town_county: string;
  school_type: string;
  contact_name: string;
  contact_role: string;
  phone: string;
  email: string;
  current_system: string;
  pain_points: string;
  source: string;
  student_count: string;
  assigned_to: string;
  next_follow_up_on: string;
  notes: string;
};

function initialState(lead: SalesLeadRow | null, defaultRepId: string): FormState {
  return {
    school_name: lead?.school_name ?? "",
    town_county: lead?.town_county ?? "",
    school_type: lead?.school_type ?? "",
    contact_name: lead?.contact_name ?? "",
    contact_role: lead?.contact_role ?? "",
    phone: lead?.phone ?? "",
    email: lead?.email ?? "",
    current_system: lead?.current_system ?? "",
    pain_points: lead?.pain_points ?? "",
    source: lead?.source ?? (lead ? "" : "door_visit"),
    student_count: lead?.student_count != null ? String(lead.student_count) : "",
    assigned_to: lead ? (lead.assigned_to ?? "") : defaultRepId,
    next_follow_up_on: lead?.next_follow_up_on ?? "",
    notes: lead?.notes ?? "",
  };
}

/**
 * Mounted only while open and keyed by the lead id by the parent, so each open starts from fresh
 * state without needing an effect to reset it.
 */
export function LeadFormDialog({
  lead,
  reps,
  defaultRepId,
  onClose,
  onSaved,
}: {
  lead: SalesLeadRow | null;
  reps: RepOption[];
  defaultRepId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(lead, defaultRepId));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    setError(null);
    const count = form.student_count.trim();
    startTransition(async () => {
      const res = await saveSalesLead({
        id: lead?.id ?? null,
        school_name: form.school_name,
        town_county: form.town_county,
        school_type: form.school_type || null,
        contact_name: form.contact_name,
        contact_role: form.contact_role,
        phone: form.phone,
        email: form.email,
        current_system: form.current_system,
        pain_points: form.pain_points,
        source: form.source || null,
        student_count: count === "" ? null : Number(count),
        assigned_to: form.assigned_to || null,
        next_follow_up_on: form.next_follow_up_on || null,
        notes: form.notes,
      });
      if ("error" in res) setError(res.error);
      else onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead ? "Edit school" : "Add a school"}</DialogTitle>
          <DialogDescription>
            {lead
              ? "Update the details. Stage changes and visit notes are logged from the table."
              : "Log a school you have visited or want to pursue. Only the school name is required."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="sl-school">School name *</Label>
            <Input id="sl-school" value={form.school_name} maxLength={200} onChange={(e) => set("school_name", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sl-town">Town / county</Label>
            <Input id="sl-town" value={form.town_county} maxLength={200} onChange={(e) => set("town_county", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>School type</Label>
            <Select value={form.school_type || NONE} onValueChange={(v) => set("school_type", v === NONE ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {SCHOOL_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sl-contact">Contact name</Label>
            <Input id="sl-contact" value={form.contact_name} maxLength={200} onChange={(e) => set("contact_name", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sl-role">Contact role</Label>
            <Input
              id="sl-role"
              placeholder="Principal, Bursar, Owner…"
              value={form.contact_role}
              maxLength={100}
              onChange={(e) => set("contact_role", e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sl-phone">Phone</Label>
            <Input id="sl-phone" value={form.phone} maxLength={40} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sl-email">Email</Label>
            <Input id="sl-email" type="email" value={form.email} maxLength={254} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sl-system">Current system</Label>
            <Input
              id="sl-system"
              placeholder="Excel, paper, name of software…"
              value={form.current_system}
              maxLength={200}
              onChange={(e) => set("current_system", e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sl-students">Number of students</Label>
            <Input
              id="sl-students"
              type="number"
              min={0}
              max={100000}
              value={form.student_count}
              onChange={(e) => set("student_count", e.target.value)}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="sl-pain">Pain they named</Label>
            <Textarea
              id="sl-pain"
              rows={2}
              maxLength={2000}
              placeholder="What frustrates them about how they work today?"
              value={form.pain_points}
              onChange={(e) => set("pain_points", e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Source</Label>
            <Select value={form.source || NONE} onValueChange={(v) => set("source", v === NONE ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Assigned rep</Label>
            <Select value={form.assigned_to || NONE} onValueChange={(v) => set("assigned_to", v === NONE ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {reps.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sl-followup">Next follow-up</Label>
            <Input id="sl-followup" type="date" value={form.next_follow_up_on} onChange={(e) => set("next_follow_up_on", e.target.value)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="sl-notes">Notes</Label>
            <Textarea id="sl-notes" rows={2} maxLength={4000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={pending || form.school_name.trim() === ""}>
            {pending ? "Saving…" : lead ? "Save changes" : "Add school"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Asks for the reason before a lead can be marked Lost (the database requires one). */
export function LostReasonDialog({
  schoolName,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  schoolName: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {schoolName} as lost?</DialogTitle>
          <DialogDescription>
            A short reason helps you learn which objection to work on (e.g. “signed with a competitor”, “no budget this
            year”).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="sl-lost">Reason *</Label>
          <Textarea id="sl-lost" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={pending || reason.trim() === ""}>
            {pending ? "Saving…" : "Mark as lost"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
