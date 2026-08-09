import { cn } from "@/lib/utils";
import { Check, CircleAlert, CircleDot, Minus, X } from "lucide-react";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const tones: Record<Tone, string> = {
  success: "bg-success-subtle text-success border-success/25",
  warning: "bg-warning-subtle text-warning border-warning/25",
  danger: "bg-destructive-subtle text-destructive border-destructive/25",
  info: "bg-info-subtle text-info border-info/25",
  neutral: "bg-muted text-muted-foreground border-border",
};

const icons: Record<Tone, typeof Check> = {
  success: Check,
  warning: CircleAlert,
  danger: X,
  info: CircleDot,
  neutral: Minus,
};

/** Status is never conveyed by color alone — every badge carries an icon + label. */
export function StatusBadge({
  tone,
  label,
  className,
  title,
}: {
  tone: Tone;
  label: string;
  className?: string;
  title?: string;
}) {
  const Icon = icons[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[0.6875rem] font-medium leading-5",
        tones[tone],
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={2.25} aria-hidden />
      {label}
    </span>
  );
}
