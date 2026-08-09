"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">School groups</h2>
        <span className="text-[0.6875rem] text-muted-foreground">
          {rows.length} group{rows.length === 1 ? "" : "s"}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="p-10 text-center text-sm text-muted-foreground">No school groups yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Group</th>
                <th>White-label</th>
                <th>Requested domain</th>
                <th>Domain status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium">{row.name}</td>
                  <td>
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
                  </td>
                  <td>
                    <code className="text-xs">{row.custom_domain ?? "—"}</code>
                  </td>
                  <td>
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
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {row.verified_at ? `Verified ${new Date(row.verified_at).toLocaleDateString()}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-border p-3 text-xs text-muted-foreground">
        &quot;Mark verified&quot; is a manual confirmation that you&apos;ve completed the DNS
        ownership check and attached the domain in Vercel — there is no automated DNS check
        yet. Do this only after following the verification runbook.
      </p>
    </div>
  );
}
