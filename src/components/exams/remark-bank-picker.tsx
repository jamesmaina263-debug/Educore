"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { searchRemarkBank, addRemarkBankEntry, REMARK_BANK_CATEGORIES, type RemarkBankEntry } from "@/app/(app)/exams/remark-bank-actions";

/**
 * Remark bank picker (Performance Appraisal Engine directive, Phase 10 /
 * roadmap Step 11). A small search-and-insert panel a teacher opens next to
 * any comment/feedback textarea. Picking a remark calls onInsert with its
 * text -- the caller decides how to merge it into their own textarea (e.g.
 * append, or replace if empty); this component never writes anything on its
 * own, so "edit before saving" (per the directive) stays entirely with
 * whatever field the teacher is actually filling in.
 *
 * currentText (optional) is the caller's own draft text. When present, a
 * "Save this comment as a reusable remark" affordance appears, wired to
 * addRemarkBankEntry -- so a teacher who writes a good comment can
 * contribute it back to the bank instead of the bank only ever growing
 * through some separate admin flow.
 */
export function RemarkBankPicker({
  onInsert,
  currentText,
}: {
  onInsert: (text: string) => void;
  currentText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RemarkBankEntry[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveCategory, setSaveCategory] = useState<string>(REMARK_BANK_CATEGORIES[0]?.value ?? "");
  const [saving, startSaving] = useTransition();
  // Tracks exactly which text was last saved, rather than a plain boolean --
  // so "Saved ✓" clears itself the moment the teacher edits the comment
  // again, computed directly during render instead of via an effect.
  const [savedText, setSavedText] = useState<string | null>(null);
  const saved = savedText !== null && savedText === currentText?.trim();

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

  function handleSave() {
    const text = currentText?.trim();
    if (!text) return;
    startSaving(async () => {
      const result = await addRemarkBankEntry({ category: saveCategory, body: text });
      if ("error" in result) return setError(result.error);
      setError(null);
      setSavedText(text);
      if (open) runSearch();
    });
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
      {currentText?.trim() && (
        <div className="mt-1 flex items-center gap-2">
          <Select value={saveCategory} onValueChange={setSaveCategory}>
            <SelectTrigger className="h-7 w-40 text-[0.7rem]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {REMARK_BANK_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-xs text-muted-foreground underline decoration-dotted hover:text-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : saved ? "Saved to remark bank ✓" : "Save this comment as a reusable remark"}
          </button>
        </div>
      )}
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
