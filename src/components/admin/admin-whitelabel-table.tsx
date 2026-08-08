"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setWhitelabelEnabled, setDomainVerified, setDomainPending } from "@/app/admin/whitelabel/actions";

export type WhitelabelGroupRow = {
  id: string;
  name: string;
  whitelabel_enabled: boolean;
  custom_domain: string | null;
  custom_domain_status: "pending" | "verified";
  verified_at: string | null;
};

export function AdminWhitelabelTable({ rows }: { rows: WhitelabelGroupRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<{ error: string } | { success: true }>) {
    setPendingId(id);
    const result = await fn();
    setPendingId(null);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    router.refresh();
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No school groups yet.</p>;
  }

  return (
    <div className="panel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead>White-label</TableHead>
            <TableHead>Requested domain</TableHead>
            <TableHead>Domain status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    tone={row.whitelabel_enabled ? "success" : "neutral"}
                    label={row.whitelabel_enabled ? "Enabled" : "Disabled"}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pendingId === row.id}
                    onClick={() => run(row.id, () => setWhitelabelEnabled(row.id, !row.whitelabel_enabled))}
                  >
                    {row.whitelabel_enabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              </TableCell>
              <TableCell>
                <code className="text-xs">{row.custom_domain ?? "—"}</code>
              </TableCell>
              <TableCell>
                {row.custom_domain ? (
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      tone={row.custom_domain_status === "verified" ? "success" : "warning"}
                      label={row.custom_domain_status === "verified" ? "Verified" : "Pending"}
                    />
                    {row.custom_domain_status === "verified" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendingId === row.id}
                        onClick={() => run(row.id, () => setDomainPending(row.id))}
                      >
                        Un-verify
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendingId === row.id}
                        onClick={() => run(row.id, () => setDomainVerified(row.id))}
                      >
                        Mark verified
                      </Button>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">No domain requested</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.verified_at ? `Verified ${new Date(row.verified_at).toLocaleDateString()}` : ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t border-border p-3 text-xs text-muted-foreground">
        &quot;Mark verified&quot; is a manual confirmation that you&apos;ve completed the DNS
        ownership check and attached the domain in Vercel — there is no automated DNS check
        yet. Do this only after following the verification runbook.
      </p>
    </div>
  );
}
