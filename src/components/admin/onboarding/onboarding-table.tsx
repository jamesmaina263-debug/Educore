import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PriorityBadge, ProgressBar, StatusBadge } from "@/components/admin/onboarding/onboarding-badges";
import { PAGE_SIZE, daysLabel, formatDate, listHref, type ListParams, type OnboardingListRow } from "@/lib/onboarding/onboarding";

// The school activity table. One page of rows from admin_onboarding_list (paginated in the database).

export function OnboardingTable({ rows, total, params }: { rows: OnboardingListRow[]; total: number; params: ListParams }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (params.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, params.page * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>School</TableHead>
              <TableHead>Administrator</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead>Password changed</TableHead>
              <TableHead>First login</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead className="text-right">Students</TableHead>
              <TableHead className="text-right">Classes</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Since last activity</TableHead>
              <TableHead>Follow-up priority</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">
                  No schools match these filters.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.school_id}>
                <TableCell className="font-medium">
                  <Link href={`/admin/onboarding/${r.school_id}`} className="text-primary underline-offset-4 hover:underline">
                    {r.school_name}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{r.admin_name ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">{r.admin_email ?? "No email on file"}</span>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(r.registered_at)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(r.password_changed_at)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(r.first_login_at)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(r.last_login_at)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.student_count.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{r.class_count.toLocaleString()}</TableCell>
                <TableCell>
                  <ProgressBar pct={r.progress_pct} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{daysLabel(r.days_since_activity)}</TableCell>
                <TableCell>
                  <PriorityBadge priority={r.priority} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <nav aria-label="Pagination" className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total === 0 ? "0 schools" : `Showing ${from}–${to} of ${total.toLocaleString()}`}
        </span>
        <span className="flex items-center gap-3">
          {params.page > 1 ? (
            <Link href={`${listHref({ ...params, page: params.page - 1 })}#schools`} className="underline">
              Previous
            </Link>
          ) : (
            <span aria-disabled="true">Previous</span>
          )}
          <span>
            Page {Math.min(params.page, pages)} of {pages}
          </span>
          {params.page < pages ? (
            <Link href={`${listHref({ ...params, page: params.page + 1 })}#schools`} className="underline">
              Next
            </Link>
          ) : (
            <span aria-disabled="true">Next</span>
          )}
        </span>
      </nav>
    </div>
  );
}
