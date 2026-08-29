import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { KpiCard } from "@/components/admin/analytics/kpi-card";
import { NotConnectedCard } from "@/components/admin/analytics/not-connected-card";
import { DateRangeTabs } from "@/components/admin/analytics/date-range-tabs";
import { BreakdownList } from "@/components/admin/analytics/breakdown-list";
import { TrafficTrendChart } from "@/components/admin/analytics/traffic-trend-chart";
import { ConversionFunnel, type FunnelStage } from "@/components/admin/analytics/conversion-funnel";
import { resolveDateRange, priorPeriod, percentChange, type PeriodKey } from "@/lib/analytics-date-range";
import {
  isPlausibleConfigured,
  getOverviewStats,
  getTimeseries,
  getTopPages,
  getTrafficSources,
  getUtmCampaigns,
  getGoalBreakdown,
  getDeviceBreakdown,
  getCountryBreakdown,
  getRealtimeVisitorCount,
} from "@/lib/plausible";

const VALID_PERIODS: PeriodKey[] = ["today", "yesterday", "7d", "30d", "90d"];

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { period: rawPeriod } = await searchParams;
  const period: PeriodKey = VALID_PERIODS.includes(rawPeriod as PeriodKey) ? (rawPeriod as PeriodKey) : "7d";
  const { plausibleRange, startIso, endIso, label } = resolveDateRange(period);
  const prior = priorPeriod(startIso, endIso);

  const [{ data: currentUser }, { data: demoRequests }, { count: priorPeriodDemoCount }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase
      .from("marketing_demo_requests")
      .select("id, created_at, status, utm_source")
      .gte("created_at", `${startIso}T00:00:00Z`)
      .lte("created_at", `${endIso}T23:59:59Z`),
    supabase
      .from("marketing_demo_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${prior.startIso}T00:00:00Z`)
      .lte("created_at", `${prior.endIso}T23:59:59Z`),
  ]);

  const demoRequestCount = demoRequests?.length ?? 0;
  const demoRequestChange = percentChange(demoRequestCount, priorPeriodDemoCount ?? 0);
  const statusCounts = new Map<string, number>();
  for (const r of demoRequests ?? []) {
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  }
  const convertedCount = statusCounts.get("converted") ?? 0;

  const plausibleConfigured = isPlausibleConfigured();
  const [overview, timeseries, topPages, sources, utmCampaigns, goals, devices, countries, realtimeVisitors] =
    plausibleConfigured
      ? await Promise.all([
          getOverviewStats(plausibleRange),
          getTimeseries(plausibleRange),
          getTopPages(plausibleRange),
          getTrafficSources(plausibleRange),
          getUtmCampaigns(plausibleRange),
          getGoalBreakdown(plausibleRange),
          getDeviceBreakdown(plausibleRange),
          getCountryBreakdown(plausibleRange),
          getRealtimeVisitorCount(),
        ])
      : [null, null, null, null, null, null, null, null, null];

  const ctaClicks = goals
    ?.filter((g) => g.goal.includes("CTA") || g.goal.includes("WhatsApp") || g.goal.includes("Email"))
    .reduce((sum, g) => sum + g.events, 0);
  const demoFormStarted = goals?.find((g) => g.goal === "Demo Form Started")?.events ?? null;
  const demoFormSubmitted = goals?.find((g) => g.goal === "Demo Request Submitted")?.events ?? null;

  const funnelStages: FunnelStage[] = [
    { label: "Website Visitors", value: overview?.visitors ?? null },
    { label: "Engaged Visitors", value: null, note: "No defined engagement threshold configured yet" },
    { label: "CTA Clicks", value: ctaClicks ?? null },
    { label: "Demo Form Started", value: demoFormStarted },
    // Real regardless of Plausible -- backed directly by marketing_demo_requests.
    { label: "Demo Request Submitted", value: demoFormSubmitted ?? demoRequestCount },
    { label: "Demo Completed", value: null, note: "No field tracks this today" },
    { label: "School Onboarded", value: convertedCount || null, note: 'Approximated from status = "converted"' },
  ];

  const roleName = (currentUser?.roles as unknown as { display_name: string } | null)?.display_name;

  return (
    <AppShell
      breadcrumbs={[{ label: "Platform admin" }, { label: "Analytics & Marketing" }]}
      userName={currentUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Analytics &amp; Marketing</h1>
            <p className="text-sm text-muted-foreground">
              How the public marketing website is performing, and whether visitors convert into
              school leads — visible to platform staff only. Showing {label.toLowerCase()}.
            </p>
          </div>
          <DateRangeTabs active={period} />
        </div>

        {/* Top-line KPIs: mixes real Plausible numbers (when connected) with real
            Supabase numbers (always available) -- never fabricated either way. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="Visitors"
            value={overview ? overview.visitors.toLocaleString() : "—"}
            sub={plausibleConfigured ? undefined : "Plausible not connected"}
          />
          <KpiCard
            label="Sessions"
            value={overview ? overview.visits.toLocaleString() : "—"}
            sub={plausibleConfigured ? undefined : "Plausible not connected"}
          />
          <KpiCard
            label="Page views"
            value={overview ? overview.pageviews.toLocaleString() : "—"}
            sub={plausibleConfigured ? undefined : "Plausible not connected"}
          />
          <KpiCard
            label="Demo requests"
            value={demoRequestCount}
            changePercent={demoRequestChange}
          />
        </div>

        {plausibleConfigured && realtimeVisitors !== null && (
          <p className="text-xs text-muted-foreground">
            {realtimeVisitors} visitor{realtimeVisitors === 1 ? "" : "s"} active right now.
          </p>
        )}

        {/* Website Analytics -- explicitly its own labeled block, distinct from
            Search Console below, per the spec. */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Website Analytics</h2>
          {!plausibleConfigured ? (
            <NotConnectedCard
              title="Plausible analytics isn't connected"
              instructions={[
                "Buy/point the production domain (src/lib/site.ts currently falls back to the Vercel preview alias).",
                "Create a Plausible account (Business tier, for Stats API access) and add the production site.",
                "Set NEXT_PUBLIC_PLAUSIBLE_DOMAIN and PLAUSIBLE_API_KEY as environment variables.",
                'Configure "Book a Demo"/CTA, WhatsApp, Email, Demo Form Started, and Demo Request Submitted as Goals in Plausible\'s site settings, so the events already firing from analytics.tsx can be broken down here.',
              ]}
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="lg:col-span-2">
                <TrafficTrendChart data={timeseries ?? []} />
              </div>
              <BreakdownList title="Top pages" rows={(topPages ?? []).map((r) => ({ label: r.label, value: r.visitors }))} />
              <BreakdownList title="Traffic sources" rows={(sources ?? []).map((r) => ({ label: r.label, value: r.visitors }))} />
              <BreakdownList
                title="Campaigns (UTM)"
                rows={(utmCampaigns ?? []).map((r) => ({
                  label: `${r.source} / ${r.medium}${r.campaign !== "(none)" ? ` / ${r.campaign}` : ""}`,
                  value: r.visitors,
                }))}
              />
              <BreakdownList
                title="CTA & event interactions"
                rows={(goals ?? []).map((r) => ({ label: r.goal, value: r.events }))}
                valueLabel="Events"
              />
              <BreakdownList title="Country" rows={(countries ?? []).map((r) => ({ label: r.label, value: r.visitors }))} />
              <BreakdownList title="Device" rows={(devices ?? []).map((r) => ({ label: r.label, value: r.visitors }))} />
            </div>
          )}
        </div>

        {/* Search Console -- deliberately separate from Website Analytics above,
            per the spec's instruction never to blend the two data sources. */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Search Console Data</h2>
          <NotConnectedCard
            title="Google Search Console isn't connected"
            instructions={[
              "Verify the production domain as a property in Google Search Console (needs a real, purchased domain first).",
              "Provision a Google Cloud service account with Search Console API access, or set up OAuth for the platform owner's account.",
              "Wire a server-side client (analogous to src/lib/plausible.ts) once the above exists — not built yet, so this section has no numbers to show.",
            ]}
          />
        </div>

        <ConversionFunnel stages={funnelStages} />

        <div className="panel p-4">
          <p className="mb-2 text-sm font-medium">Demo requests by status ({label.toLowerCase()})</p>
          {statusCounts.size === 0 ? (
            <p className="text-xs text-muted-foreground">No demo requests in this period.</p>
          ) : (
            <ul className="flex flex-wrap gap-4 text-sm">
              {Array.from(statusCounts.entries()).map(([status, count]) => (
                <li key={status} className="flex items-baseline gap-1.5">
                  <span className="font-semibold">{count}</span>
                  <span className="text-muted-foreground">{status.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Full submission detail lives at{" "}
            <a href="/admin/demo-requests" className="text-primary underline underline-offset-2">
              Demo Requests
            </a>
            .
          </p>
        </div>
      </div>
    </AppShell>
  );
}
