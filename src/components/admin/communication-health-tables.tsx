import { StatusBadge } from "@/components/status-badge";

export interface QueueBySchoolRow {
  school_id: string;
  school_name: string;
  count: number;
  oldest_at: string;
  stale: boolean;
}

export interface FailureRow {
  id: string;
  school_name: string;
  channel: string;
  recipient_type: string;
  reason: string | null;
  updated_at: string;
}

// Hours-and-minutes age string, not a raw timestamp -- "stuck 31h" is what a platform admin
// needs to act on here, not a date they'd have to do the subtraction on themselves.
function ageLabel(iso: string): string {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "<1h";
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function CommunicationHealthTables({
  queueRows,
  failureRows,
  staleHours,
}: {
  queueRows: QueueBySchoolRow[];
  failureRows: FailureRow[];
  staleHours: number;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Queue depth by school</h2>
          <span className="text-[0.6875rem] text-muted-foreground" title={`A row here means nobody at that school has visited Communication (which is what triggers dispatch) since the oldest queued message was created`}>
            Stuck = oldest queued item older than {staleHours}h
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>School</th>
                <th>Queued</th>
                <th>Oldest item</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {queueRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-sm text-muted-foreground">
                    Nothing queued anywhere right now.
                  </td>
                </tr>
              ) : (
                queueRows.map((row) => (
                  <tr key={row.school_id}>
                    <td className="font-medium">{row.school_name}</td>
                    <td>{row.count}</td>
                    <td className="text-muted-foreground">{ageLabel(row.oldest_at)}</td>
                    <td>
                      {row.stale ? (
                        <StatusBadge tone="danger" label="Stuck" />
                      ) : (
                        <StatusBadge tone="neutral" label="Normal" />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Recent failed dispatches</h2>
          <span className="text-[0.6875rem] text-muted-foreground">Last {failureRows.length}</span>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>School</th>
                <th>Channel</th>
                <th>To</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {failureRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-sm text-muted-foreground">
                    No failures in recent history.
                  </td>
                </tr>
              ) : (
                failureRows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.school_name}</td>
                    <td className="uppercase text-muted-foreground">{row.channel}</td>
                    <td className="text-muted-foreground">{row.recipient_type}</td>
                    <td className="max-w-64 truncate text-muted-foreground" title={row.reason ?? undefined}>
                      {row.reason ?? "—"}
                    </td>
                    <td className="text-muted-foreground">{ageLabel(row.updated_at)} ago</td>
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
