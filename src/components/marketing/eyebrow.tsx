import { cn } from "@/lib/utils";

// Structural label, not decoration: this is the face the product's own
// dashboards would set a data label in (IBM Plex Mono is already loaded for
// exactly that purpose -- see globals.css). Used above section headlines to
// name what the section is ("PLATFORM", "PRICING"), and inline for module
// counts / stat labels in the Dashboard Frame and stat readouts.
export function Eyebrow({
  children,
  tone = "light",
  className,
}: {
  children: React.ReactNode;
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.14em]",
        tone === "light" ? "text-marketing-gold-500" : "text-marketing-blue",
        className,
      )}
    >
      <span
        className={cn(
          "h-1 w-4 rounded-full",
          tone === "light" ? "bg-marketing-gold-500" : "bg-marketing-blue",
        )}
      />
      {children}
    </span>
  );
}
