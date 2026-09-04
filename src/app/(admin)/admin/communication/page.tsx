import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { KpiCard } from "@/components/admin/analytics/kpi-card";
import { CommunicationHealthTables } from "@/components/admin/communication-health-tables";

// How dispatch actually happens today (see supabase/functions/send-communication/index.ts):
// there is no background cron pushing "queued" rows out. A row only leaves "queued" when
// someone with communication.write visits that specific school's Communication page, which
// then dispatches up to 100 queued rows for that school. That means a queued row can sit
// indefinitely if nobody at that school opens the page -- this dashboard exists to surface
// that blind spot across every school from one place, rather than each school silently
// wondering "did that go out?" until a parent complains.
const STALE_QUEUE_HOURS = 24;

export default async function AdminCommunicationHealthPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const nowMs = new Date().getTime();
  const sevenDaysAgoIso = new Date(nowMs - 7 * 86_400_000).toISOString();

  // Same "fetch it all, group in JS" convention as /admin and /admin/analytics -- this
  // platform has a small number of tenant schools and notification_logs volume to match, so
  // an unaggregated fetch per query is simpler and cheap here too (see those pages' own notes
  // on why this isn't the right call once school counts grow into the thousands).
  const [{ data: schools }, { data: queued }, { data: recentOutcomes }, { data: recentFailures }] =
    await Promise.all([
      supabase.from("schools").select("id, name"),
      // No time bound -- a stuck queue is exactly the thing that can be arbitrarily old, and
      // there should never be enough queued rows platform-wide for this to be expensive.
      supabase
        .from("notification_logs")
        .select("id, school_id, channel, created_at")
        .eq("status", "queued")
        .order("created_at", { ascending: true }),
      supabase
        .from("notification_logs")
        .select("channel, status")
        .in("status", ["sent", "delivered", "failed"])
        .gte("created_at", sevenDaysAgoIso),
      supabase
        .from("notification_logs")
        .select("id, school_id, channel, recipient_type, provider_response, updated_at")
        .eq("status", "failed")
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);

  const schoolNameById = new Map((schools ?? []).map((s) => [s.id, s.name]));

  const CHANNELS = ["sms", "email", "whatsapp"] as const;
  const channelStats = CHANNELS.map((channel) => {
    const rows = (recentOutcomes ?? []).filter((r) => r.channel === channel);
    const sent = rows.filter((r) => r.status === "sent" || r.status === "delivered").length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const total = sent + failed;
    return {
      channel,
      sent,
      failed,
      successRate: total === 0 ? null : (sent / total) * 100,
    };
  });

  const totalQueued = (queued ?? []).length;
  const staleQueued = (queued ?? []).filter(
    (r) => nowMs - new Date(r.created_at).getTime() > STALE_QUEUE_HOURS * 3_600_000,
  );

  const queueBySchool = new Map<string, { count: number; oldest: string }>();
  for (const row of queued ?? []) {
    const existing = queueBySchool.get(row.school_id);
    if (existing) {
      existing.count += 1;
    } else {
      queueBySchool.set(row.school_id, { count: 1, oldest: row.created_at });
    }
  }
  const queueRows = Array.from(queueBySchool.entries())
    .map(([schoolId, v]) => ({
      school_id: schoolId,
      school_name: schoolNameById.get(schoolId) ?? "Unknown school",
      count: v.count,
      oldest_at: v.oldest,
      stale: nowMs - new Date(v.oldest).getTime() > STALE_QUEUE_HOURS * 3_600_000,
    }))
    .sort((a, b) => new Date(a.oldest_at).getTime() - new Date(b.oldest_at).getTime());

  const failureRows = (recentFailures ?? []).map((f) => ({
    id: f.id,
    school_name: schoolNameById.get(f.school_id) ?? "Unknown school",
    channel: f.channel as string,
    recipient_type: f.recipient_type as string,
    reason: f.provider_response,
    updated_at: f.updated_at as string,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Communication delivery health</h1>
        <p className="text-sm text-muted-foreground">
          Queue depth, per-channel success rate (last 7 days), and recent failures across every school.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Queued right now"
          value={totalQueued}
          sub={staleQueued.length > 0 ? `${staleQueued.length} stuck 24h+` : "None stuck"}
        />
        {channelStats.map((c) => (
          <KpiCard
            key={c.channel}
            label={`${c.channel.toUpperCase()} success (7d)`}
            value={c.successRate === null ? "—" : `${c.successRate.toFixed(0)}%`}
            sub={c.successRate === null ? "No sends yet" : `${c.sent} sent · ${c.failed} failed`}
          />
        ))}
      </div>

      <CommunicationHealthTables queueRows={queueRows} failureRows={failureRows} staleHours={STALE_QUEUE_HOURS} />
    </div>
  );
}
