"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface MedicalRecord {
  id: string;
  blood_group: string | null;
  conditions: string | null;
  allergies: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
}

export function MedicalTab({ studentId }: { studentId: string }) {
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<MedicalRecord | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<MedicalRecord>>({});

  async function reveal() {
    setConfirmed(true);
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      // Log the access first — this IS the trigger point for the audit
      // entry (§S.4/§L), tied to this explicit confirmation click.
      await supabase.rpc("log_medical_record_access", { p_student_id: studentId });

      const { data, error: fetchError } = await supabase
        .from("medical_records")
        .select("id, blood_group, conditions, allergies, emergency_contact_name, emergency_contact_phone, notes")
        .eq("student_id", studentId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      setRecord(data);
      setForm(data ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the medical record.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: upsertError } = await supabase
        .from("medical_records")
        .upsert(
          { student_id: studentId, ...form },
          { onConflict: "student_id" },
        );
      if (upsertError) throw upsertError;
      setRecord({ id: record?.id ?? "", ...form } as MedicalRecord);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  if (!confirmed) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="mb-3 text-sm text-muted-foreground">
          Medical information is sensitive and access is logged. Confirm you need to view it.
        </p>
        <Button onClick={reveal}>I need to view this</Button>
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  if (!editing) {
    return (
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Blood group</dt>
            <dd>{record?.blood_group ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Conditions</dt>
            <dd>{record?.conditions ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Allergies</dt>
            <dd>{record?.allergies ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Emergency contact</dt>
            <dd>
              {record?.emergency_contact_name
                ? `${record.emergency_contact_name} (${record.emergency_contact_phone ?? "no phone"})`
                : "—"}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">Notes</dt>
            <dd>{record?.notes ?? "—"}</dd>
          </div>
        </dl>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="blood_group">Blood group</Label>
          <Input
            id="blood_group"
            value={form.blood_group ?? ""}
            onChange={(e) => setForm({ ...form, blood_group: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emergency_contact_phone">Emergency contact phone</Label>
          <Input
            id="emergency_contact_phone"
            value={form.emergency_contact_phone ?? ""}
            onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="emergency_contact_name">Emergency contact name</Label>
        <Input
          id="emergency_contact_name"
          value={form.emergency_contact_name ?? ""}
          onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="conditions">Conditions</Label>
        <Textarea
          id="conditions"
          value={form.conditions ?? ""}
          onChange={(e) => setForm({ ...form, conditions: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="allergies">Allergies</Label>
        <Textarea
          id="allergies"
          value={form.allergies ?? ""}
          onChange={(e) => setForm({ ...form, allergies: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={form.notes ?? ""}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
