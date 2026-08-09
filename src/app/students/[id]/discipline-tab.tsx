"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export interface DisciplineRow {
  id: string;
  incident_date: string;
  category: "minor" | "moderate" | "major";
  description: string;
  action_taken: string | null;
  visible_to_guardian: boolean;
}

const CATEGORY_TONE: Record<DisciplineRow["category"], "neutral" | "warning" | "danger"> = {
  minor: "neutral",
  moderate: "warning",
  major: "danger",
};

export function DisciplineTab({
  studentId,
  records,
  canWrite,
}: {
  studentId: string;
  records: DisciplineRow[];
  canWrite: boolean;
}) {
  const [rows, setRows] = useState(records);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<DisciplineRow["category"]>("minor");
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [visibleToGuardian, setVisibleToGuardian] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    if (!description.trim()) {
      setError("A description is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: me } = await supabase.auth.getUser();
      const { data: schoolUser } = await supabase
        .from("school_users")
        .select("id, school_id")
        .eq("auth_user_id", me.user?.id)
        .maybeSingle();
      if (!schoolUser) throw new Error("Could not resolve your account.");

      const { data, error: insertError } = await supabase
        .from("discipline_records")
        .insert({
          school_id: schoolUser.school_id,
          student_id: studentId,
          category,
          description: description.trim(),
          action_taken: actionTaken.trim() || null,
          visible_to_guardian: visibleToGuardian,
          recorded_by: schoolUser.id,
        })
        .select("id, incident_date, category, description, action_taken, visible_to_guardian")
        .single();
      if (insertError) throw insertError;

      setRows((prev) => [data as DisciplineRow, ...prev]);
      setDescription("");
      setActionTaken("");
      setVisibleToGuardian(true);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the record.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No discipline records.</p>}
      {rows.map((r) => (
        <div key={r.id} className="rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <StatusBadge tone={CATEGORY_TONE[r.category]} label={r.category} />
            <span className="text-xs text-muted-foreground">{r.incident_date}</span>
            {!r.visible_to_guardian && (
              <span className="text-xs text-muted-foreground">· internal only</span>
            )}
          </div>
          <p className="mt-1 text-sm">{r.description}</p>
          {r.action_taken && (
            <p className="mt-1 text-xs text-muted-foreground">Action taken: {r.action_taken}</p>
          )}
        </div>
      ))}

      {canWrite && !showForm && (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
          Record incident
        </Button>
      )}

      {canWrite && showForm && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v: DisciplineRow["category"]) => setCategory(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minor">Minor</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="major">Major</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="incident_description">Description</Label>
            <Textarea id="incident_description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="action_taken">Action taken (optional)</Label>
            <Textarea id="action_taken" value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="visible_to_guardian"
              checked={visibleToGuardian}
              onCheckedChange={(v) => setVisibleToGuardian(v === true)}
            />
            <Label htmlFor="visible_to_guardian" className="font-normal">
              Visible to parent/guardian
            </Label>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={record} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
