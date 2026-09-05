"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { searchRemarkBank, REMARK_BANK_CATEGORIES, type RemarkBankEntry } from "@/app/(app)/exams/remark-bank-actions";

/**
 * Remark bank picker (Performance Appraisal Engine directive, Phase 10 /
 * roadmap Step 11). A small search-and-insert panel a teacher opens next to
 * any comment/feedback textarea. Picking a remark calls onInsert with its
 * text -- the caller decides how to merge it into their own textarea (e.g.
 * append, or replace if empty); this component never writes anything on its
 * own, so "edit before saving" (per the directive) stays entirely with
 * whatever field the teacher is actually filling in.
 */
export function RemarkBankPicker({ onInsert }: { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RemarkBankEntry[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runSearch(nextCategory = category, nextQuery = query) {
    startTransition(async () => {
      const result = await searchRemarkBank({ category: nextCategory || undefined, query: nextQuery || undefined });
      if ("error" in result) return setError(result.error);
      setError(null);
      setResults(result.items);
    });
  }

  function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && results === null) runSearch();
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleOpen}
        className="text-xs text-muted-foreground underline decoration-dotted hover:text-foreground"
      >
        {open ? "Hide remark bank" : "Insert from remark bank"}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-2">
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <Select
              value={category}
              onValueChange={(v) => {
                const next = v === "all" ? "" : v;
                setCategory(next);
                runSearch(next, query);
              }}
            >
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {REMARK_BANK_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Search remarks…"
              value={query}
              className="h-8 text-xs"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
            />
            <Button size="sm" variant="outline" className="h-8" disabled={pending} onClick={() => runSearch()}>
              Search
            </Button>
          </div>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {pending && <p className="text-xs text-muted-foreground">Searching…</p>}
            {!pending && results?.length === 0 && <p className="text-xs text-muted-foreground">No matching remarks.</p>}
            {(results ?? []).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onInsert(r.body)}
                className="rounded-sm border border-border bg-background px-2 py-1.5 text-left text-xs hover:border-primary hover:bg-primary/5"
              >
                <span className="mr-1.5 rounded bg-muted px-1 py-0.5 text-[0.625rem] text-muted-foreground">
                  {REMARK_BANK_CATEGORIES.find((c) => c.value === r.category)?.label ?? r.category}
                </span>
                {r.body}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
