"use client";

import { useState } from "react";
import { updateEmployment } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export interface EmploymentData {
  position: string | null;
  department: string | null;
  hire_date: string | null;
  contract_type: "permanent" | "contract" | "part_time" | null;
  contract_end_date: string | null;
}

export function EmploymentTab({
  staffId,
  data,
  canManage,
}: {
  staffId: string;
  data: EmploymentData;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<EmploymentData>(data);

  async function save() {
    setSaving(true);
    setError(null);
    const result = await updateEmployment(staffId, form);
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Position</dt>
            <dd>{data.position ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Department</dt>
            <dd>{data.department ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Hire date</dt>
            <dd>{data.hire_date ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Contract type</dt>
            <dd className="capitalize">{data.contract_type?.replace("_", " ") ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Contract end date</dt>
            <dd>{data.contract_end_date ?? "—"}</dd>
          </div>
        </dl>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="position">Position</Label>
          <Input
            id="position"
            value={form.position ?? ""}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="department">Department</Label>
          <Input
            id="department"
            value={form.department ?? ""}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="hire_date">Hire date</Label>
          <Input
            id="hire_date"
            type="date"
            value={form.hire_date ?? ""}
            onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Contract type</Label>
          <Select
            value={form.contract_type ?? undefined}
            onValueChange={(v: "permanent" | "contract" | "part_time") => setForm({ ...form, contract_type: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="permanent">Permanent</SelectItem>
              <SelectItem value="contract">Contract</SelectItem>
              <SelectItem value="part_time">Part-time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contract_end_date">Contract end date</Label>
        <Input
          id="contract_end_date"
          type="date"
          value={form.contract_end_date ?? ""}
          onChange={(e) => setForm({ ...form, contract_end_date: e.target.value })}
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
