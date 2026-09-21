import { Skeleton } from "@/components/ui/skeleton";

// Shown inside the persistent app shell (sidebar/topbar stay put) while a page's server
// data streams in, so navigation gives instant feedback instead of appearing frozen.
// Generic on purpose: a header, a row of summary cards and a table -- close enough to most
// pages that the swap to real content doesn't jump. Add a page-level loading.tsx next to a
// specific page if it deserves a closer match.
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-6 w-56" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="panel mt-6 p-4">
        <Skeleton className="h-5 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
