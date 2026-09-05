// How dispatch actually happens today (see supabase/functions/send-communication/index.ts):
// there's no background cron pushing "queued" rows out. A row only leaves "queued" when
// someone with communication.write visits this page, which then dispatches up to 100 queued
// rows. That means a queued row can sit indefinitely if nobody opens Communication -- this
// tab surfaces that before a parent/guardian complains about a message that never arrived,
// same reasoning as the History tab existing for messages that did go out.
const STALE_QUEUE_HOURS = 24;

export interface ChannelStat {
  channel: "sms" | "email" | "whatsapp";
  sent: number;
  failed: number;
  successRate: number | null;
}

export interface QueuedItem {
  id: string;
  channel: string;
  created_at: string;
}

export interface FailedItem {
  id: string;
  channel: string;
  recipient_type: string | null;
  reason: string | null;
  updated_at: string;
}

function ageLabel(iso: string, nowMs: number): string {
  const hours = Math.floor((nowMs - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "<1h";
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function DeliveryHealthSection({
  queued,
  channelStats,
  failures,
}: {
  queued: QueuedItem[];
  channelStats: ChannelStat[];
  failures: FailedItem[];
}) {
  const nowMs = new Date().getTime();
  const oldestQueued = queued.length > 0 ? queued[0] : null;
  const stuck = oldestQueued ? nowMs - new Date(oldestQueued.created_at).getTime() > STALE_QUEUE_HOURS * 3_600_000 : false;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Whether SMS/Email/WhatsApp are actually going out -- queue depth, delivery success over the last 7 days, and
        recent failures for this school.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground">Queued right now</p>
          <p className="mt-1 text-2xl font-semibold">{queued.length}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {oldestQueued
              ? `Oldest: ${ageLabel(oldestQueued.created_at, nowMs)}${stuck ? " -- stuck" : ""}`
              : "Nothing waiting"}
          </p>
        </div>
        {channelStats.map((c) => (
          <div key={c.channel} className="panel p-4">
            <p className="text-xs text-muted-foreground">{c.channel.toUpperCase()} success (7d)</p>
            <p className="mt-1 text-2xl font-semibold">{c.successRate === null ? "—" : `${c.successRate.toFixed(0)}%`}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {c.successRate === null ? "No sends yet" : `${c.sent} sent · ${c.failed} failed`}
            </p>
          </div>
        ))}
      </div>

      {stuck && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          The oldest queued message has been waiting over {STALE_QUEUE_HOURS}h. Queued messages only go out when this
          page is opened by someone with send permission -- if this keeps happening, someone needs to check
          Communication more regularly.
        </p>
      )}

      <div className="panel">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Recent failed dispatches</h2>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Channel</th>
                <th>To</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {failures.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-sm text-muted-foreground">
                    No failures in recent history.
                  </td>
                </tr>
              ) : (
                failures.map((f) => (
                  <tr key={f.id}>
                    <td className="uppercase text-muted-foreground">{f.channel}</td>
                    <td className="text-muted-foreground">{f.recipient_type ?? "—"}</td>
                    <td className="max-w-96 truncate text-muted-foreground" title={f.reason ?? undefined}>
                      {f.reason ?? "—"}
                    </td>
                    <td className="text-muted-foreground">{ageLabel(f.updated_at, nowMs)} ago</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
