import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FollowupQueue } from "@/components/admin/onboarding/followup-queue";
import { OnboardingFilters } from "@/components/admin/onboarding/onboarding-filters";
import { OnboardingSettingsPanel } from "@/components/admin/onboarding/settings-panel";
import { OnboardingSummaryCards } from "@/components/admin/onboarding/onboarding-summary";
import { OnboardingTable } from "@/components/admin/onboarding/onboarding-table";
import {
  PAGE_SIZE,
  parseListParams,
  type FollowupQueueRow,
  type OnboardingConfig,
  type OnboardingListRow,
  type OnboardingSummary,
} from "@/lib/onboarding/onboarding";

export const dynamic = "force-dynamic";

// School Onboarding & Engagement Monitor. Super admin only (the admin layout and every database function check it).
// Every figure comes from the database, calculated from real records at read time; nothing is hardcoded. If the
// functions are missing (code live a moment before its migration) the page says so instead of failing.
export default async function AdminOnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const params = parseListParams(await searchParams);

  const [summaryRes, listRes, queueRes, configRes, teamRes] = await Promise.all([
    supabase.rpc("admin_onboarding_summary"),
    supabase.rpc("admin_onboarding_list", {
      p_status: params.status,
      p_registered_from: params.from,
      p_registered_to: params.to,
      p_activity: params.activity,
      p_search: params.q || null,
      p_sort: params.sort,
      p_limit: PAGE_SIZE,
      p_offset: (params.page - 1) * PAGE_SIZE,
    }),
    supabase.rpc("admin_onboarding_followup_queue", { p_limit: 25, p_offset: 0 }),
    supabase.rpc("admin_get_onboarding_config"),
    supabase.from("platform_team_members").select("id, name").eq("active", true).order("name"),
  ]);

  const firstError = summaryRes.error ?? listRes.error;
  const summary = (summaryRes.error ? null : summaryRes.data) as OnboardingSummary | null;
  const rows = (listRes.error ? [] : (listRes.data ?? [])) as OnboardingListRow[];
  const total = rows[0]?.total_count ?? 0;
  const queue = (queueRes.error ? [] : (queueRes.data ?? [])) as FollowupQueueRow[];
  const queueTotal = queue[0]?.total_count ?? 0;
  const config = (configRes.error ? null : configRes.data) as OnboardingConfig | null;
  const team = (teamRes.data ?? []) as { id: string; name: string }[];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">School onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Where every registered school is in onboarding, and which ones need a person. Statuses update automatically from what each school actually does.
          Visible to platform staff only.
        </p>
      </div>

      {firstError && (
        <p className="text-xs text-destructive" role="alert">
          The onboarding data could not be read ({firstError.message}). Nothing is shown rather than guessing.
        </p>
      )}

      {summary && <OnboardingSummaryCards summary={summary} activeStatus={params.status} />}

      <FollowupQueue rows={queue} total={queueTotal} team={team} />

      <div id="schools" className="flex scroll-mt-4 flex-col gap-3">
        <h2 className="text-sm font-semibold">All schools</h2>
        <OnboardingFilters params={params} />
        <OnboardingTable rows={rows} total={total} params={params} />
      </div>

      {config ? (
        <OnboardingSettingsPanel config={config} team={team} />
      ) : (
        <p className="text-xs text-muted-foreground">Automation settings are unavailable{configRes.error ? ` (${configRes.error.message})` : ""}.</p>
      )}
    </div>
  );
}
