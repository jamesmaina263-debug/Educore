"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Drives DataTable's `manual` (server-paginated) mode from the URL, so a page
 * reload, a shared link, and the browser back button all land on the same
 * page/search state instead of it living only in transient client state.
 *
 * Search is debounced client-side (250ms) before it touches the URL/router,
 * so a router.push + server re-fetch doesn't fire on every keystroke.
 */
export function useServerTableParams({ totalCount, pageSize = 20 }: { totalCount: number; pageSize?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const pageParam = Number(searchParams.get("page") ?? "1");
  const pageIndex = Number.isFinite(pageParam) && pageParam > 0 ? pageParam - 1 : 0;
  const urlSearch = searchParams.get("q") ?? "";

  // Local echo of the search box so typing feels instant even though the
  // actual query only fires after the debounce below.
  const [searchDraft, setSearchDraft] = useState(urlSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the draft in sync if the URL changes from elsewhere (e.g. the back
  // button). Adjusted during render rather than in an effect -- setState-in-
  // effect causes an extra render pass; this "track the last seen prop value,
  // compare during render" approach is React's own recommended alternative
  // for syncing local state to an external value. See:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [lastSeenUrlSearch, setLastSeenUrlSearch] = useState(urlSearch);
  if (urlSearch !== lastSeenUrlSearch) {
    setLastSeenUrlSearch(urlSearch);
    setSearchDraft(urlSearch);
  }

  const pushParams = useCallback(
    (next: { page?: number; q?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.page !== undefined) {
        if (next.page <= 1) params.delete("page");
        else params.set("page", String(next.page));
      }
      if (next.q !== undefined) {
        if (!next.q) params.delete("q");
        else params.set("q", next.q);
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const onPageChange = useCallback(
    (nextPageIndex: number) => {
      pushParams({ page: nextPageIndex + 1 });
    },
    [pushParams],
  );

  const onSearchChange = useCallback(
    (value: string) => {
      setSearchDraft(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // A new search always goes back to page 1 -- staying on page 4 of a
        // now-much-shorter filtered result set would just show "no results".
        pushParams({ q: value, page: 1 });
      }, 250);
    },
    [pushParams],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));

  return {
    pageIndex,
    pageCount,
    onPageChange,
    totalCount,
    search: searchDraft,
    onSearchChange,
    /** The value to actually filter by server-side (already-committed URL value, not the draft). */
    committedSearch: urlSearch,
  };
}
