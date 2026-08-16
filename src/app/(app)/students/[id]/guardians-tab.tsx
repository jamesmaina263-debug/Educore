"use client";

import { useState } from "react";
import { addGuardian, searchGuardians, linkExistingGuardian, type GuardianSearchResult } from "./actions";
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

type Relationship = "mother" | "father" | "guardian" | "other";

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
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GuardianSearchResult[] | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relationship, setRelationship] = useState<Relationship>("mother");
  const [primaryContact, setPrimaryContact] = useState(guardians.length === 0);
  const [createForm, setCreateForm] = useState({ phone: "", full_name: "", email: "" });

  async function runSearch() {
    setSearching(true);
    setError(null);
    const result = await searchGuardians(query);
    setSearching(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setResults(result);
  }

  async function link(guardianId: string) {
    setPending(true);
    setError(null);
    const result = await linkExistingGuardian(studentId, guardianId, relationship, primaryContact);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    resetPanel();
  }

  async function create() {
    setPending(true);
    setError(null);
    const result = await addGuardian(studentId, {
      ...createForm,
      email: createForm.email || undefined,
      relationship,
      primary_contact: primaryContact,
    });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    resetPanel();
  }

  function resetPanel() {
    setAdding(false);
    setQuery("");
    setResults(null);
    setShowCreateForm(false);
    setCreateForm({ phone: "", full_name: "", email: "" });
    setRelationship("mother");
    setPrimaryContact(false);
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
              <Label>Relationship</Label>
              <Select value={relationship} onValueChange={(v: Relationship) => setRelationship(v)}>
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
                checked={primaryContact}
                onChange={(e) => setPrimaryContact(e.target.checked)}
                className="size-4 rounded-sm border-border"
              />
              <Label htmlFor="ag_primary" className="mb-0">
                Primary contact
              </Label>
            </div>
          </div>

          {!showCreateForm ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="gsearch">Search existing guardians by name or phone</Label>
                <div className="flex gap-2">
                  <Input
                    id="gsearch"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    placeholder="e.g. Jane or 07…"
                  />
                  <Button size="sm" variant="outline" onClick={runSearch} disabled={searching || query.trim().length < 2}>
                    {searching ? "Searching…" : "Search"}
                  </Button>
                </div>
              </div>

              {results !== null && (
                <div className="rounded-md border border-border">
                  {results.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">
                      No existing guardian matches &ldquo;{query}&rdquo;.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {results.map((r) => (
                        <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                          <div>
                            <span className="font-medium">{r.full_name}</span>{" "}
                            <span className="text-muted-foreground">
                              — {r.phone ?? "no phone"}
                              {r.linked_student_count > 0 &&
                                ` · already linked to ${r.linked_student_count} student${r.linked_student_count === 1 ? "" : "s"}`}
                            </span>
                          </div>
                          <Button size="sm" onClick={() => link(r.id)} disabled={pending}>
                            Link
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <Button size="sm" variant="ghost" onClick={() => setShowCreateForm(true)}>
                Can&apos;t find them? Add a new guardian
              </Button>
            </>
          ) : (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ag_phone">Phone</Label>
                  <Input
                    id="ag_phone"
                    value={createForm.phone}
                    onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ag_name">Full name</Label>
                  <Input
                    id="ag_name"
                    value={createForm.full_name}
                    onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ag_email">Email (optional)</Label>
                <Input
                  id="ag_email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={create} disabled={pending}>
                  {pending ? "Adding…" : "Create & link"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowCreateForm(false)} disabled={pending}>
                  Back to search
                </Button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
          <Button size="sm" variant="outline" onClick={resetPanel} disabled={pending}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
