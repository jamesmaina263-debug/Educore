import { StatusBadge } from "@/components/status-badge";
import { formatKes } from "@/lib/billing/format";
import { ENTRY_LABELS, type LedgerEntryLite } from "@/lib/canteen";

export interface PortalCanteenEntry extends LedgerEntryLite {
  id: string;
  note: string | null;
  createdAt: string;
}
export interface PortalCanteenPurchase {
  id: string;
  total: number;
  tender: "wallet" | "cash";
  status: "completed" | "voided";
  createdAt: string;
  lines: string[];
}

const when = (ts: string) => new Date(ts).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });

/**
 * Read-only canteen wallet for the selected child: balance, recent wallet activity and recent purchases.
 * Money is added or paid back in cash at the canteen; nothing here moves money.
 */
export function PortalCanteenSection({ hasWallet, balance, entries, purchases }: { hasWallet: boolean; balance: number; entries: PortalCanteenEntry[]; purchases: PortalCanteenPurchase[] }) {
  if (!hasWallet && purchases.length === 0) {
    return <p className="text-sm text-muted-foreground">No canteen wallet yet. Money is added at the canteen by the staff, in cash.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg font-semibold">Wallet balance: {formatKes(balance)}</p>
      {purchases.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent purchases</p>
          <ul className="divide-y">
            {purchases.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className={`text-sm ${p.status === "voided" ? "text-muted-foreground line-through" : "font-medium"}`}>{p.lines.join(", ")}</p>
                  <p className="text-xs text-muted-foreground">{when(p.createdAt)} · {p.tender === "wallet" ? "from wallet" : "cash"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {p.status === "voided" && <StatusBadge tone="neutral" label="Cancelled" />}
                  <span className="text-sm">{formatKes(p.total)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {entries.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Wallet activity</p>
          <ul className="divide-y">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {ENTRY_LABELS[e.kind]}
                  <br />
                  <span className="text-xs text-muted-foreground">{when(e.createdAt)}</span>
                </span>
                <span className="text-right">
                  {e.amount > 0 ? "+" : "-"}
                  {formatKes(Math.abs(e.amount))}
                  <br />
                  <span className="text-xs text-muted-foreground">balance {formatKes(e.balanceAfter)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
