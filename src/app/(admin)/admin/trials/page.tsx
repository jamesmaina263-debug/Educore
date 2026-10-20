import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TrialFollowupView } from "@/components/admin/trial-followup";
import Link from "next/link";
import { RECENTLY_EXPIRED_DAYS, buildTrialFollowup } from "@/lib/growth/trial-followup";
import { summariseCheckins, type CheckinRow } from "@/lib/growth/trial-checkins";
import {
  assembleTrialInputs,
  type LastActiveRow,
  type SchoolRow,
  type SchoolUserRow,
  type SubscriptionRow,
} from "@/lib/growth/trial-followup-data";

// Same auth gate as the other platform-admin pages: the (admin) layout already enforces super admin; this
// repeats it (defense in depth). Reads existing tables only (no migration): schools, school_subscriptions,
// school_users, and the admin_school_last_active() RPC the admin home page already uses; plus the
// trial_checkins log (and platform_team_members for names). If the log cannot be read the page still loads
// and says so, rather than implying nobody was contacted.
export default async function AdminTrialFollowupPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const cutoff = new Date(new Date().getTime() - RECENTLY_EXPIRED_DAYS * 86_400_000).toISOString();

  // Trials running now, plus schools whose trial ended recently and were suspended. Two plain filtered
  // queries (rather than one nested or(...) filter string) so every filter is a standard, easily checked one.
  const cols = "school_id, status, trial_ends_at, created_at";
  const [runningRes, endedRes] = await Promise.all([
    supabase.from("school_subscriptions").select(cols).eq("status", "trialing"),
    supabase.from("school_subscriptions").select(cols).in("status", ["past_due", "suspended"]).gte("trial_ends_at", cutoff),
  ]);
  const subsError = runningRes.error ?? endedRes.error;

  const header = (
    <div>
      <h1 className="text-lg font-semibold">Trial follow-up</h1>
      <p className="text-sm text-muted-foreground">
        Which trial schools need a human check-in, and why. Suggestions only: nothing is sent from this page. Visible to
        platform staff only.
      </p>
      <p className="text-sm">
        <Link href="/admin/trials/nudges" className="underline">
          Trial messages
        </Link>{" "}
        (propose, approve and send an email to a trial school&apos;s owner)
      </p>
      <p className="text-sm">
        <Link href="/admin/sales-whatsapp" className="underline">
          Sales WhatsApp
        </Link>{" "}
        (who agreed to WhatsApp contact, and messages you send them)
      </p>
    </div>
  );

  if (subsError) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="panel p-4 text-sm">
          <p className="font-medium">Trial follow-up couldn&apos;t load.</p>
          <p className="mt-1 text-muted-foreground">{subsError.message}. Nothing is shown rather than guessing.</p>
        </div>
      </div>
    );
  }

  const subs = [...(runningRes.data ?? []), ...(endedRes.data ?? [])] as SubscriptionRow[];
  const ids = subs.map((s) => s.school_id);

  if (ids.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <TrialFollowupView data={buildTrialFollowup([])} />
      </div>
    );
  }

  const [schoolsRes, lastActiveRes, usersRes, checkinsRes, teamRes] = await Promise.all([
    supabase.from("schools").select("id, name, slug, status, created_at").in("id", ids),
    supabase.rpc("admin_school_last_active"),
    // Active school users with their role: owners give the contact, everyone who is not a parent, student or
    // platform admin counts as staff. Same role filter the admin home page uses for its staff count.
    supabase
      .from("school_users")
      .select("school_id, full_name, email, roles!inner(name)")
      .in("school_id", ids)
      .eq("status", "active")
      .not("roles.name", "in", "(parent,student,super_admin)"),
    supabase
      .from("trial_checkins")
      .select("school_id, created_at, channel, outcome, performed_by")
      .in("school_id", ids)
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase.from("platform_team_members").select("id, name").eq("active", true).order("name"),
  ]);

  const firstError = schoolsRes.error ?? lastActiveRes.error ?? usersRes.error;
  if (firstError) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="panel p-4 text-sm">
          <p className="font-medium">Trial follow-up couldn&apos;t load.</p>
          <p className="mt-1 text-muted-foreground">{firstError.message}. Nothing is shown rather than guessing.</p>
        </div>
      </div>
    );
  }

  const team = (teamRes.data ?? []) as { id: string; name: string }[];
  const checkinsAvailable = !checkinsRes.error;
  const checkins = summariseCheckins(
    checkinsAvailable ? ((checkinsRes.data ?? []) as CheckinRow[]) : [],
    new Map(team.map((m) => [m.id, m.name])),
  );

  const inputs = assembleTrialInputs({
    subscriptions: subs,
    schools: (schoolsRes.data ?? []) as SchoolRow[],
    lastActive: (lastActiveRes.data ?? []) as LastActiveRow[],
    users: (usersRes.data ?? []) as SchoolUserRow[],
    checkins,
  });

  return (
    <div className="flex flex-col gap-4">
      {header}
      <TrialFollowupView data={buildTrialFollowup(inputs)} teamMembers={team} checkinsAvailable={checkinsAvailable} />
    </div>
  );
}
