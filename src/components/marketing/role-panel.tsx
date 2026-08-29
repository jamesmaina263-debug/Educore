import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

// The Solutions page's per-role deep-dive block. Denser and more narrative
// than the homepage's compressed role grid (Phase 3, Section 8) on purpose:
// that grid is a preview, this is the expansion the Phase 5 brief asks for.
// Outcome-first structure (headline promise, then a short narrative, then
// what actually changes day to day) rather than a bare feature list, per
// "outcome-focused (not feature lists)" in the roadmap.
export function RolePanel({
  icon: Icon,
  id,
  eyebrowLabel,
  headline,
  narrative,
  changes,
  tone = "canvas",
  visual,
}: {
  icon: LucideIcon;
  id: string;
  eyebrowLabel: string;
  headline: string;
  narrative: string;
  changes: string[];
  tone?: "canvas" | "navy";
  visual?: React.ReactNode;
}) {
  const dark = tone === "navy";
  return (
    <div id={id} className="scroll-mt-24">
      <div
        className={cn(
          "grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start",
          visual ? "" : "lg:grid-cols-1",
        )}
      >
        <div>
          <div
            className={cn(
              "mb-5 flex h-11 w-11 items-center justify-center rounded-lg",
              dark
                ? "bg-marketing-gold-500/10 text-marketing-gold-400"
                : "bg-marketing-blue/10 text-marketing-blue",
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <p
            className={cn(
              "font-mono text-xs font-medium uppercase tracking-[0.14em]",
              dark ? "text-marketing-gold-500" : "text-marketing-blue",
            )}
          >
            {eyebrowLabel}
          </p>
          <h2
            className={cn(
              "mt-3 text-2xl font-semibold tracking-tight sm:text-3xl",
              dark ? "text-white" : "text-marketing-navy-950",
            )}
          >
            {headline}
          </h2>
          <p
            className={cn(
              "mt-4 max-w-xl text-base leading-relaxed",
              dark ? "text-white/65" : "text-marketing-navy-900/70",
            )}
          >
            {narrative}
          </p>

          <ul className="mt-6 flex flex-col gap-3">
            {changes.map((c) => (
              <li
                key={c}
                className={cn(
                  "flex items-start gap-3 text-sm leading-relaxed",
                  dark ? "text-white/75" : "text-marketing-navy-900/75",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full",
                    dark ? "bg-marketing-gold-500" : "bg-marketing-blue",
                  )}
                />
                {c}
              </li>
            ))}
          </ul>
        </div>

        {visual && <div className="lg:pt-16">{visual}</div>}
      </div>
    </div>
  );
}
