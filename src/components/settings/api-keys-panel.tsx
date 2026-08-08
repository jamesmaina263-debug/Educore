"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

// v1 is read-only by design (Phase 5 Item 3) -- the CHECK constraint on api_keys.scopes
// enforces this server-side too, this list is just what the UI offers.
const AVAILABLE_SCOPES = [
  { value: "students.read", label: "Students (roster only — no medical/discipline records)" },
  { value: "attendance.read", label: "Attendance summaries" },
  { value: "fees.read", label: "Fee balances" },
  { value: "exams.read", label: "Exam results" },
] as const;

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  status: "active" | "revoked";
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

type IssueResult =
  | { error: string }
  | { success: true; raw_key: string; key_prefix: string };
type RevokeResult = { error: string } | { success: true };

export function ApiKeysPanel({
  rows,
  canManage,
  issueAction,
  revokeAction,
}: {
  rows: ApiKeyRow[];
  canManage: boolean;
  issueAction: (input: { name: string; scopes: string[] }) => Promise<IssueResult>;
  revokeAction: (id: string) => Promise<RevokeResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  function toggleScope(value: string) {
    setScopes((s) => (s.includes(value) ? s.filter((v) => v !== value) : [...s, value]));
  }

  async function handleIssue() {
    if (!name.trim() || scopes.length === 0) {
      setError("Give the key a name and at least one scope.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await issueAction({ name: name.trim(), scopes });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setIssuedKey(result.raw_key);
    router.refresh();
  }

  function handleClose(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setName("");
      setScopes([]);
      setIssuedKey(null);
      setError(null);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    await revokeAction(id);
    setRevokingId(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="label-eyebrow">{rows.length} key{rows.length === 1 ? "" : "s"}</p>
        {canManage && (
          <Dialog open={open} onOpenChange={handleClose}>
            <DialogTrigger asChild>
              <Button size="sm">New API key</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{issuedKey ? "Key created" : "New API key"}</DialogTitle>
              </DialogHeader>

              {issuedKey ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Copy this now — it won&apos;t be shown again. EduCore only stores a hash of it.
                  </p>
                  <code className="block break-all rounded bg-muted p-3 text-xs">{issuedKey}</code>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="key_name">Name</Label>
                    <Input
                      id="key_name"
                      placeholder="e.g. Parent app integration"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Scopes (read-only)</Label>
                    <div className="space-y-2">
                      {AVAILABLE_SCOPES.map((s) => (
                        <label key={s.value} className="flex items-start gap-2 text-sm">
                          <Checkbox
                            checked={scopes.includes(s.value)}
                            onCheckedChange={() => toggleScope(s.value)}
                          />
                          <span>{s.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {error && <p className="text-sm text-danger">{error}</p>}
                </div>
              )}

              <DialogFooter>
                {issuedKey ? (
                  <Button onClick={() => handleClose(false)}>Done</Button>
                ) : (
                  <Button onClick={handleIssue} disabled={pending}>
                    {pending ? "Creating…" : "Create key"}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No API keys yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last used</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell>
                  <code className="text-xs">{row.key_prefix}…</code>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.scopes.map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={row.status === "active" ? "default" : "secondary"}>
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.last_used_at ? new Date(row.last_used_at).toLocaleDateString() : "Never"}
                </TableCell>
                {canManage && (
                  <TableCell>
                    {row.status === "active" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={revokingId === row.id}
                        onClick={() => handleRevoke(row.id)}
                      >
                        {revokingId === row.id ? "Revoking…" : "Revoke"}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="text-xs text-muted-foreground">
        Keys are read-only in this release — they can&apos;t create, edit, or delete anything in
        EduCore. Every request made with a key is logged for audit purposes.
      </p>
    </div>
  );
}
