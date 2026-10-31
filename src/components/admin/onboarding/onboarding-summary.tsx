import Link from "next/link";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, listHref, type OnboardingStatus, type OnboardingSummary } from "@/lib/onboarding/onboarding";

// Summary cards. Every figure is counted by the database from real records (admin_onboarding_summary); nothing here
// is hardcoded. Each card filters the table below to that status.

const CARDS: { key: keyof OnboardingSummary & (OnboardingStatus | "total"); label: string; status: OnboardingStatus | null; attention?: boolean }[] = [
  { key: "total", label: "Registered schools", status: null },
  { key: "password_pending", label: STATUS_LABELS.password_pending, status: "password_pending", attention: true },
  { key: "not_started", label: STATUS_LABELS.not_started, status: "not_started" },
  { key: "logged_in_no_setup", label: STATUS_LABELS.logged_in_no_setup, status: "logged_in_no_setup", attention: true },
  { key: "setting_up", label: STATUS_LABELS.setting_up, status: "setting_up" },
  { key: "complete", label: STATUS_LABELS.complete, status: "complete" },
  { key: "inactive", label: "Flagged inactive", status: "inactive", attention: true },
];

export function OnboardingSummaryCards({ summary, activeStatus }: { summary: OnboardingSummary; activeStatus: OnboardingStatus | null }) {
  return (
    <section aria-label="Onboarding summary" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {CARDS.map((c) => {
        const value = summary[c.key];
        const selected = c.status === activeStatus && (c.status !== null || activeStatus === null);
        return (
          <Link
            key={c.key}
            href={`${listHref({ status: c.status })}#schools`}
            aria-current={selected && c.status !== null ? "true" : undefined}
            className={cn(
              "flex flex-col gap-1 rounded-md border border-border bg-surface p-3 transition-colors hover:bg-accent",
              selected && c.status !== null && "border-primary ring-1 ring-primary",
            )}
          >
            <span className={cn("text-2xl font-semibold tabular-nums", c.attention && value > 0 && "text-amber-700")}>{value.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground">{c.label}</span>
          </Link>
        );
      })}
    </section>
  );
}
