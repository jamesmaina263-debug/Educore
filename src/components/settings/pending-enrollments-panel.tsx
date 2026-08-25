"use client";

// Review UI for biometric_enrollment_events -- device-pushed PIN+Name
// signals (see that table's migration comment) that need a human to pick
// the real EduCore student/staff record they belong to before any
// biometric_credentials row gets created. This is the missing half of
// "enrollment adapter": the ADMS route stages these; this panel is what
// actually closes the loop into a working credential.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export interface PendingEnrollmentRow {
  id: string;
  device_id: string;
  device_name: string;
  provider: string;
  provider_user_id: string;
  provider_user_name: string | null;
  created_at: string;
}

type SearchResult = { person_type: "student" | "staff"; person_id: string; name: string; subtitle: string };
type ActionResult = { error: string } | { success: true };

export function PendingEnrollmentsPanel({
  rows,
  canManage,
  searchAction,
  linkAction,
  ignoreAction,
}: {
  rows: PendingEnrollmentRow[];
  canManage: boolean;
  searchAction: (query: string) => Promise<{ error: string } | { success: true; results: SearchResult[] }>;
  linkAction: (input: {
    enrollment_event_id: string;
    device_id: string;
    provider_user_id: string;
    person_type: "student" | "staff";
    person_id: string;
    credential_type: "fingerprint" | "face";
    provider: string;
  }) => Promise<ActionResult>;
  ignoreAction: (id: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [linkingRow, setLinkingRow] = useState<PendingEnrollmentRow | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ignoringId, setIgnoringId] = useState<string | null>(null);

  if (rows.length === 0 && !canManage) return null;

  async function handleSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const result = await searchAction(q);
    setSearching(false);
    if ("success" in result) setResults(result.results);
  }

  async function handleLink(person: SearchResult) {
    if (!linkingRow) return;
    setSaving(true);
    setError(null);
    const result = await linkAction({
      enrollment_event_id: linkingRow.id,
      device_id: linkingRow.device_id,
      provider_user_id: linkingRow.provider_user_id,
      person_type: person.person_type,
      person_id: person.person_id,
      credential_type: "fingerprint",
      provider: linkingRow.provider,
    });
    setSaving(false);
    if ("error" in result) return setError(result.error);
    closeDialog();
    router.refresh();
  }

  async function handleIgnore(id: string) {
    setIgnoringId(id);
    await ignoreAction(id);
    setIgnoringId(null);
    router.refresh();
  }

  function closeDialog() {
    setLinkingRow(null);
    setQuery("");
    setResults([]);
    setError(null);
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Pending device enrollments</h3>
        <Badge variant={rows.length > 0 ? "default" : "secondary"}>{rows.length} pending</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        When someone is enrolled directly on a push-protocol device (e.g. a ZKTeco terminal), it tells EduCore the device&apos;s own
        PIN and whatever name was typed on the device — never anything biometric. Link each one to the real student or staff record
        it belongs to before it can verify anyone.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing pending.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Device PIN</TableHead>
              <TableHead>Name on device</TableHead>
              <TableHead>Pushed</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.device_name}</TableCell>
                <TableCell>
                  <code className="text-xs">{row.provider_user_id}</code>
                </TableCell>
                <TableCell>{row.provider_user_name ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(row.created_at).toLocaleString()}</TableCell>
                {canManage && (
                  <TableCell className="flex gap-2">
                    <Button size="sm" onClick={() => setLinkingRow(row)}>
                      Link…
                    </Button>
                    <Button variant="ghost" size="sm" disabled={ignoringId === row.id} onClick={() => handleIgnore(row.id)}>
                      {ignoringId === row.id ? "…" : "Ignore"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!linkingRow} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Link PIN {linkingRow?.provider_user_id}
              {linkingRow?.provider_user_name ? ` ("${linkingRow.provider_user_name}")` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Search students or staff by name…" value={query} onChange={(e) => handleSearch(e.target.value)} autoFocus />
            {searching && <p className="text-xs text-muted-foreground">Searching…</p>}
            {error && <p className="text-sm text-danger">{error}</p>}
            {results.length > 0 && (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {results.map((r) => (
                  <button
                    key={`${r.person_type}-${r.person_id}`}
                    type="button"
                    disabled={saving}
                    onClick={() => handleLink(r)}
                    className="flex w-full items-center justify-between rounded-md border p-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <span>{r.name}</span>
                    <span className="text-xs text-muted-foreground">{r.subtitle}</span>
                  </button>
                ))}
              </div>
            )}
            {query.trim().length >= 2 && !searching && results.length === 0 && (
              <p className="text-xs text-muted-foreground">No matches.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
