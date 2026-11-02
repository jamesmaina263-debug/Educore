import Link from "next/link";
import {
  APPROVAL_KINDS,
  APPROVAL_KIND_ORDER,
  formatKes,
  isOverdue,
  waitingLabel,
  type ApprovalItem,
  type ApprovalKind,
} from "@/lib/approvals-inbox";
import { withSchoolSlug } from "@/lib/school-slug-href";

export function ApprovalsInbox({
  items,
  allowed,
  failed,
  schoolSlug,
  now,
}: {
  items: ApprovalItem[];
  /** Kinds the person holds the approving permission for. */
  allowed: ApprovalKind[];
  /** Kinds whose query failed: shown as "could not load" instead of a false "nothing waiting". */
  failed: ApprovalKind[];
  schoolSlug: string | undefined;
  now: Date;
}) {
  if (allowed.length === 0) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        Nothing is assigned to you for approval. Approvals appear here when your role can approve leave, purchase
        requisitions, expenses or fee discounts.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {APPROVAL_KIND_ORDER.filter((k) => allowed.includes(k)).map((kind) => {
        const rows = items.filter((i) => i.kind === kind);
        return (
          <section key={kind} className="panel" aria-label={APPROVAL_KINDS[kind].label}>
            <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <p className="text-sm font-medium">{APPROVAL_KINDS[kind].label}</p>
              <p className="text-xs text-muted-foreground">{failed.includes(kind) ? "Could not load" : `${rows.length} waiting`}</p>
            </header>
            {failed.includes(kind) ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                This list could not be loaded just now. Refresh the page; nothing has been lost.
              </p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">Nothing waiting.</p>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((i) => (
                  <li key={`${i.kind}-${i.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {i.title}
                        {i.amount !== null ? <span className="ml-2 text-muted-foreground">{formatKes(i.amount)}</span> : null}
                      </p>
                      {i.detail ? <p className="truncate text-xs text-muted-foreground">{i.detail}</p> : null}
                      <p className="text-xs text-muted-foreground">
                        {i.requestedBy ? `Requested by ${i.requestedBy} · ` : ""}
                        <span className={isOverdue(i.createdAt, now) ? "text-danger" : undefined}>{waitingLabel(i.createdAt, now)}</span>
                        {i.own ? " · Your own request" : ""}
                      </p>
                    </div>
                    <Link className="text-sm font-medium text-primary hover:underline" href={withSchoolSlug(schoolSlug, i.href)}>
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
