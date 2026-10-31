import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ONBOARDING_STATUSES,
  SORTS,
  SORT_LABELS,
  STATUS_LABELS,
  type ListParams,
} from "@/lib/onboarding/onboarding";

// A plain GET form: every view is a shareable URL and works without JavaScript. The values are re-validated by
// parseListParams on the server, and the database re-validates them again.

const field = "h-8 rounded-md border border-input bg-background px-2 text-[0.8125rem]";

export function OnboardingFilters({ params }: { params: ListParams }) {
  const filtered = params.status || params.activity || params.from || params.to || params.q || params.sort !== "newest";
  return (
    <form method="get" action="/admin/onboarding" className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3" aria-label="Filter schools">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Search
        <input name="q" defaultValue={params.q} maxLength={100} placeholder="School, administrator or email" className={`${field} w-56`} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Status
        <select name="status" defaultValue={params.status ?? ""} className={field}>
          <option value="">All statuses</option>
          {ONBOARDING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Activity
        <select name="activity" defaultValue={params.activity ?? ""} className={field}>
          <option value="">Any</option>
          <option value="active">Recently active</option>
          <option value="quiet">Quiet (no recent activity)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Registered from
        <input type="date" name="from" defaultValue={params.from ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Registered to
        <input type="date" name="to" defaultValue={params.to ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Sort by
        <select name="sort" defaultValue={params.sort} className={field}>
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Apply
        </Button>
        {filtered && (
          <Button asChild type="button" size="sm" variant="ghost">
            <Link href="/admin/onboarding#schools">Clear</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
