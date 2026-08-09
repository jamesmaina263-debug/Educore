"use client";

import { useState } from "react";
import { addQualification } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface QualificationRow {
  id: string;
  qualification_name: string;
  institution: string | null;
  year_obtained: number | null;
  expiry_date: string | null;
}

export function QualificationsTab({
  staffId,
  qualifications,
  canManage,
}: {
  staffId: string;
  qualifications: QualificationRow[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ qualification_name: "", institution: "", year_obtained: "", expiry_date: "" });

  async function submit() {
    if (!form.qualification_name.trim()) {
      setError("Qualification name is required.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await addQualification(staffId, {
      qualification_name: form.qualification_name,
      institution: form.institution || undefined,
      year_obtained: form.year_obtained ? Number(form.year_obtained) : undefined,
      expiry_date: form.expiry_date || undefined,
    });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setAdding(false);
    setForm({ qualification_name: "", institution: "", year_obtained: "", expiry_date: "" });
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {qualifications.map((q) => {
          const expiringSoon = q.expiry_date && q.expiry_date < today;
          return (
            <li key={q.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{q.qualification_name}</span>{" "}
                <span className="text-muted-foreground">
                  {q.institution ? `— ${q.institution}` : ""} {q.year_obtained ? `(${q.year_obtained})` : ""}
                </span>
              </div>
              {q.expiry_date && (
                <span className={expiringSoon ? "text-xs font-medium text-danger" : "text-xs text-muted-foreground"}>
                  {expiringSoon ? "Expired " : "Expires "}
                  {q.expiry_date}
                </span>
              )}
            </li>
          );
        })}
        {qualifications.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-muted-foreground">No qualifications on file.</li>
        )}
      </ul>

      {canManage && !adding && (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          Add qualification
        </Button>
      )}

      {canManage && adding && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qn">Qualification name</Label>
              <Input
                id="qn"
                value={form.qualification_name}
                onChange={(e) => setForm({ ...form, qualification_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qi">Institution</Label>
              <Input
                id="qi"
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qy">Year obtained</Label>
              <Input
                id="qy"
                type="number"
                value={form.year_obtained}
                onChange={(e) => setForm({ ...form, year_obtained: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qe">Expiry date (if applicable)</Label>
              <Input
                id="qe"
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              />
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
