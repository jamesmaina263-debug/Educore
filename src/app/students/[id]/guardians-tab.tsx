"use client";

import { useState } from "react";
import { addGuardian } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export interface GuardianRow {
  id: string;
  full_name: string;
  phone: string | null;
  relationship: string;
  primary_contact: boolean;
}

export function GuardiansTab({
  studentId,
  guardians,
  canManage,
}: {
  studentId: string;
  guardians: GuardianRow[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    phone: "",
    full_name: "",
    email: "",
    relationship: "mother" as "mother" | "father" | "guardian" | "other",
    primary_contact: guardians.length === 0,
  });

  async function submit() {
    setPending(true);
    setError(null);
    const result = await addGuardian(studentId, {
      ...form,
      email: form.email || undefined,
    });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setAdding(false);
    setForm({ phone: "", full_name: "", email: "", relationship: "mother", primary_contact: false });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {guardians.map((g) => (
          <li key={g.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <span className="font-medium">{g.full_name}</span>{" "}
              <span className="text-muted-foreground">
                — {g.relationship} — {g.phone ?? "no phone"}
              </span>
            </div>
            {g.primary_contact && <Badge variant="outline">Primary contact</Badge>}
          </li>
        ))}
        {guardians.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-muted-foreground">
            No guardians linked yet.
          </li>
        )}
      </ul>

      {canManage && !adding && (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          Add guardian
        </Button>
      )}

      {canManage && adding && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ag_phone">Phone</Label>
              <Input
                id="ag_phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ag_name">Full name</Label>
              <Input
                id="ag_name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Relationship</Label>
              <Select
                value={form.relationship}
                onValueChange={(v: "mother" | "father" | "guardian" | "other") =>
                  setForm({ ...form, relationship: v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mother">Mother</SelectItem>
                  <SelectItem value="father">Father</SelectItem>
                  <SelectItem value="guardian">Guardian</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-2">
              <input
                id="ag_primary"
                type="checkbox"
                checked={form.primary_contact}
                onChange={(e) => setForm({ ...form, primary_contact: e.target.checked })}
                className="size-4 rounded-sm border-border"
              />
              <Label htmlFor="ag_primary" className="mb-0">
                Primary contact
              </Label>
            </div>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
