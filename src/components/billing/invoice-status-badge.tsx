import { StatusBadge } from "@/components/status-badge";
import { statusLabel, statusTone } from "@/lib/billing/format";

/** One badge for invoice status everywhere (admin register, detail, school billing page). */
export function InvoiceStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge tone={statusTone(status)} label={statusLabel(status)} className={className} />;
}
