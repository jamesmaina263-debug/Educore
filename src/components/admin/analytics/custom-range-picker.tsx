"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CustomRangePicker({ from, to }: { from?: string; to?: string }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [localFrom, setLocalFrom] = useState(from ?? today);
  const [localTo, setLocalTo] = useState(to ?? today);

  function apply() {
    if (!localFrom || !localTo || localFrom > localTo) return;
    router.push(`/admin/analytics?period=custom&from=${localFrom}&to=${localTo}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="flex items-center gap-1.5 text-sm"
    >
      <input
        type="date"
        value={localFrom}
        max={localTo}
        onChange={(e) => setLocalFrom(e.target.value)}
        className="rounded border border-border bg-background px-2 py-1 text-xs"
        aria-label="From date"
      />
      <span className="text-muted-foreground">–</span>
      <input
        type="date"
        value={localTo}
        min={localFrom}
        max={today}
        onChange={(e) => setLocalTo(e.target.value)}
        className="rounded border border-border bg-background px-2 py-1 text-xs"
        aria-label="To date"
      />
      <button
        type="submit"
        className="rounded border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium hover:bg-muted"
      >
        Apply
      </button>
    </form>
  );
}
