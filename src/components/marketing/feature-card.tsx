import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function FeatureCard({
  icon: Icon,
  title,
  description,
  tone = "canvas",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: "canvas" | "navy";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-6 transition-colors",
        tone === "canvas" &&
          "border-marketing-navy-900/10 bg-white hover:border-marketing-navy-900/20",
        tone === "navy" &&
          "border-white/10 bg-white/[0.03] hover:border-marketing-gold-500/30",
        className,
      )}
    >
      <div
        className={cn(
          "mb-4 flex h-10 w-10 items-center justify-center rounded-lg",
          tone === "canvas" ? "bg-marketing-blue/10 text-marketing-blue" : "bg-marketing-gold-500/10 text-marketing-gold-400",
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h3
        className={cn(
          "text-base font-semibold",
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
    </div>
  );
}
