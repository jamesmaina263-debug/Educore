import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

// Denser than FeatureCard on purpose: the Platform page (unlike the
// homepage's compressed module grid) needs room for what a module does,
// who it's for, and a short capability list per the Phase 4 brief -- so
// this renders as a bordered block with real structure, not just an icon
// + two lines.
export function ModuleBlock({
  icon: Icon,
  title,
  audience,
  description,
  capabilities,
  tone = "canvas",
  className,
}: {
  icon: LucideIcon;
  title: string;
  audience: string;
  description: string;
  capabilities: string[];
  tone?: "canvas" | "navy";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-6",
        tone === "canvas"
          ? "border-marketing-navy-900/10 bg-white"
          : "border-white/10 bg-white/[0.03]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div
          className={cn(
            "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
            tone === "canvas"
              ? "bg-marketing-blue/10 text-marketing-blue"
              : "bg-marketing-gold-500/10 text-marketing-gold-400",
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <span
          className={cn(
            "font-mono text-[10px] font-medium uppercase tracking-[0.1em]",
            tone === "canvas" ? "text-marketing-navy-900/60" : "text-white/50",
          )}
        >
          {audience}
        </span>
      </div>

      <h3
        className={cn(
          "mt-4 text-base font-semibold",
          tone === "canvas" ? "text-marketing-navy-950" : "text-white",
        )}
      >
        {title}
      </h3>
      <p
        className={cn(
          "mt-2 text-sm leading-relaxed",
          tone === "canvas" ? "text-marketing-navy-900/65" : "text-white/60",
        )}
      >
        {description}
      </p>

      <ul className="mt-4 flex flex-col gap-1.5">
        {capabilities.map((c) => (
          <li
            key={c}
            className={cn(
              "flex items-start gap-2 text-xs leading-relaxed",
              tone === "canvas" ? "text-marketing-navy-900/60" : "text-white/55",
            )}
          >
            <span
              className={cn(
                "mt-1.5 h-1 w-1 flex-shrink-0 rounded-full",
                tone === "canvas" ? "bg-marketing-blue" : "bg-marketing-gold-500",
              )}
            />
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}
