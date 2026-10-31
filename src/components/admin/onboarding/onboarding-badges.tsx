import { cn } from "@/lib/utils";
import {
  PRIORITY_LABELS,
  PRIORITY_TONE,
  STATUS_LABELS,
  STATUS_TONE,
  isOnboardingStatus,
  isPriority,
} from "@/lib/onboarding/onboarding";

// Small presentational pieces shared by the dashboard and the school page. The label is always written out; colour
// is only a second cue.

export function StatusBadge({ status }: { status: string }) {
  const known = isOnboardingStatus(status);
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
        known ? STATUS_TONE[status] : "border-border bg-muted text-foreground",
      )}
    >
      {known ? STATUS_LABELS[status] : status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const known = isPriority(priority);
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
        known ? PRIORITY_TONE[priority] : "border-border bg-muted text-foreground",
      )}
    >
      {known ? PRIORITY_LABELS[priority] : priority}
    </span>
  );
}

export function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label="Onboarding progress"
        className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{value}%</span>
    </div>
  );
}
