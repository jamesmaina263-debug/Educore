"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  updateDocumentRequirement,
  type DocumentRequirementRow,
} from "@/app/(app)/settings/admission-documents/actions";

export function DocumentRequirementsPanel({ rows, canWrite }: { rows: DocumentRequirementRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function save(id: string, changes: { required?: boolean; label?: string }) {
    setError(null);
    startTransition(async () => {
      const result = await updateDocumentRequirement(id, changes);
      if ("error" in result) { setError(result.error); return; }
      setEditingId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Documents required for admission</h2>
        <p className="text-sm text-muted-foreground">
          A student can only be enrolled once every <strong>required</strong> document has been uploaded and verified.
          Optional documents can still be collected, but never block enrollment.
        </p>
      </div>

      <ul className="divide-y divide-border rounded-md border border-border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              {editingId === row.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} className="w-64 max-w-full" />
                  <Button size="sm" onClick={() => save(row.id, { label: draft })} disabled={pending}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              ) : (
                <p className="text-sm font-medium">{row.label}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {canWrite && editingId !== row.id && (
                <Button size="sm" variant="ghost" onClick={() => { setDraft(row.label); setEditingId(row.id); setError(null); }}>Rename</Button>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={row.required}
                  disabled={!canWrite || pending}
                  onChange={(e) => save(row.id, { required: e.target.checked })}
                />
                Required
              </label>
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">No document types are set up for this school.</li>}
      </ul>

      {!canWrite && <p className="text-xs text-muted-foreground">You can view these settings but need admissions access to change them.</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
