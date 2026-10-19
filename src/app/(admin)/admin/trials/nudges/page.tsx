import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RECENTLY_EXPIRED_DAYS } from "@/lib/growth/trial-followup";
import { TrialNudgesPanel, type NudgeRow } from "@/components/admin/trial-nudges";

export const dynamic = "force-dynamic";

// Trial messages: propose, approve and send emails to trial-school owners. Super admin only. Every rule is enforced
// in the database (20261018220000_trial_nudges.sql); this page reads the queue and the settings. If the tables are
// missing (code live a moment before its migration) it says so instead of failing.
export default async function AdminTrialNudgesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const cutoff = new Date(new Date().getTime() - RECENTLY_EXPIRED_DAYS * 86_400_000).toISOString();
  const cols = "school_id, status, trial_ends_at";
  const [settingsRes, nudgesRes, runningRes, endedRes, teamRes] = await Promise.all([
    supabase.rpc("admin_get_trial_nudge_settings"),
    supabase
      .from("trial_nudges")
      .select(
        "id, created_at, school_id, kind, recipient_email, recipient_name, subject, body, payload_hash, status, proposed_by, reviewed_by, reviewed_at, review_note, queued_at, sent_at, error",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("school_subscriptions").select(cols).eq("status", "trialing"),
    supabase.from("school_subscriptions").select(cols).in("status", ["past_due", "suspended"]).gte("trial_ends_at", cutoff),
    supabase.from("platform_team_members").select("id, name").eq("active", true).order("name"),
  ]);

  const settingsRow = Array.isArray(settingsRes.data) ? settingsRes.data[0] : null;
  const settings = !settingsRes.error && settingsRow ? { sending_enabled: settingsRow.sending_enabled === true, promotional_enabled: settingsRow.promotional_enabled === true } : null;

  const subs = [...(runningRes.data ?? []), ...(endedRes.data ?? [])] as { school_id: string; status: string; trial_ends_at: string | null }[];
  const nudgeRows = (nudgesRes.error ? [] : (nudgesRes.data ?? [])) as Omit<NudgeRow, "school_name">[];
  const ids = Array.from(new Set([...subs.map((s) => s.school_id), ...nudgeRows.map((n) => n.school_id)]));
  const { data: schoolRows } = ids.length
    ? await supabase.from("schools").select("id, name").in("id", ids)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((schoolRows ?? []).map((s) => [s.id, s.name]));

  const schools = subs
    .map((s) => ({ id: s.school_id, name: nameById.get(s.school_id) ?? "Unknown school", label: s.status === "trialing" ? "trial running" : "trial ended" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const nudges: NudgeRow[] = nudgeRows.map((n) => ({ ...n, school_name: nameById.get(n.school_id) ?? "Unknown school" }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/admin/trials" className="text-xs text-muted-foreground underline">
          Back to trial follow-up
        </Link>
        <h1 className="text-lg font-semibold">Trial messages</h1>
        <p className="text-sm text-muted-foreground">
          Propose, approve and send emails to the owners of trial schools. Nothing is sent without a person approving the
          exact text and clicking Send. Visible to platform staff only.
        </p>
      </div>
      {nudgesRes.error && (
        <p className="text-xs text-destructive">The message queue could not be read ({nudgesRes.error.message}). Nothing is shown rather than guessing.</p>
      )}
      <TrialNudgesPanel settings={settings} nudges={nudges} schools={schools} team={(teamRes.data ?? []) as { id: string; name: string }[]} nowIso={new Date().toISOString()} />
    </div>
  );
}
