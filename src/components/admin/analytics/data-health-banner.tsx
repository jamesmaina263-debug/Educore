import { assessAnalyticsHealth, type AnalyticsHealthInput } from "@/lib/analytics-health";

// One quiet line above the KPI cards when Google Analytics and our own counter disagree, so a "0"
// that is really a processing delay (or a broken tag) is explained instead of looking like no traffic.
// Renders nothing when everything is consistent.
export function DataHealthBanner(props: AnalyticsHealthInput) {
  const health = assessAnalyticsHealth(props);
  if (health.status === "ok") return null;
  const isWarning = health.status === "ga-missing" || health.status === "ga-error";
  return (
    <div
      role="status"
      className={`panel p-3 text-xs ${isWarning ? "border-destructive/40 text-foreground" : "text-muted-foreground"}`}
    >
      <span className="font-medium">{isWarning ? "Check this: " : "Note: "}</span>
      {health.message}
    </div>
  );
}
