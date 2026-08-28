import { cn } from "@/lib/utils";

// Smaller sibling of DashboardFrame (see dashboard-frame.tsx for the full
// rationale). Same browser-chrome-on-navy-stage visual language, same rule
// (real app tokens inside, no invented UI), but takes arbitrary children
// instead of one fixed layout -- so later phases can reuse the *pattern*
// for a module snapshot without reusing the exact same component, per the
// Phase 4 brief's "don't overuse the exact same frame every time".
export function MiniFrame({
  path = "app.educore.io",
  children,
  className,
}: {
  path?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl bg-marketing-navy-900 p-1.5 shadow-xl ring-1 ring-marketing-gold-500/25",
        className,
      )}
    >
      <div className="overflow-hidden rounded-lg bg-white">
        <div className="flex items-center gap-1.5 border-b border-border bg-secondary px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/25" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/25" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/25" />
          <span className="ml-2 font-mono text-[10px] text-muted-foreground">{path}</span>
        </div>
        <div className="bg-background p-3.5">{children}</div>
      </div>
    </div>
  );
}
